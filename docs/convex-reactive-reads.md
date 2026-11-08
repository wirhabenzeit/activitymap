# Convex auth and reactive reads (design)

Status: proposal, step 2 of the Convex migration (follows shadow writes, #499).
Tracks #496.

## Goal

Let preview owners load and follow their library through live, paginated
Convex queries instead of REST bootstrap and change polling, while Postgres
stays the writer and the shadow mirror keeps Convex current. Measure cold load
and time to first map on real data, and decide from those numbers whether the
reactive path reaches the under-10-second target. Everything here is read-only,
behind a per-owner flag, and reversible.

Out of scope: moving writers or Strava tokens, the iOS client (keeps the
cursor feed), photos (not stored in Convex yet).

## 1. Authentication

### Decision: keep Better Auth where it is; issue Convex JWTs from it

Better Auth has a native Convex integration, `@convex-dev/better-auth`. It runs
the Better Auth server inside Convex HTTP actions and stores users, sessions
and accounts in Convex component tables; Next.js only proxies `/api/auth/*`.
That is a full auth migration: user IDs, sessions and the Strava OAuth tokens
would move to Convex while Postgres ingestion still reads those tokens. It
belongs with step 3 (moving the writers), not here.

For read-only access we only need Convex to know who the caller is. Better
Auth's own `jwt` plugin (in the installed 1.7.x) issues short-lived JWTs
signed with a key pair whose public half Convex verifies as a
[custom JWT provider](https://docs.convex.dev/auth/advanced/custom-jwt).
Sessions, cookies, the `bearer` plugin for iOS and the Strava callback hook
stay unchanged.

Revisit when the writers move: if Strava tokens and ingestion move into
Convex, adopting `@convex-dev/better-auth` then puts auth next to the code
that uses the tokens. That migration needs a user-ID plan (every Postgres
table and the Convex `owners` table key on the Better Auth user ID).

### Token issuance (Next.js)

- Add `jwt()` to the Better Auth plugins with:
  - `jwks.keyPairConfig.alg = 'ES256'`. Convex accepts only RS256 and ES256;
    the plugin's default (EdDSA) would be rejected.
  - `jwt.definePayload` returning nothing beyond the standard claims, so the
    token carries no profile data; `sub` is the user ID.
  - `jwt.issuer` fixed per environment (`ACTIVITYMAP_AUTH_JWT_ISSUER`), for
    example `https://activitymap.cc` in production. Preview deployments run on
    changing `*.vercel.app` hosts, so the issuer must not follow the request
    host.
  - `jwt.audience = 'convex'`, `jwt.expirationTime = '15m'`.
- The plugin stores its key pair in a `jwks` table: add it to the Drizzle
  schema with a migration. The private key is encrypted with the Better Auth
  secret.
- Clients get a token from `GET /api/auth/token` (cookie or bearer session).
  The same endpoint later serves iOS.

### Verification (Convex)

```ts
// backend/convex/auth.config.ts
export default {
  providers: [
    {
      type: 'customJwt',
      issuer: process.env.ACTIVITYMAP_AUTH_JWT_ISSUER!,
      applicationID: 'convex',
      algorithm: 'ES256',
      // Static data URI of the app's public JWKS: no fetch per validation,
      // and no dependency on the app being reachable from Convex.
      jwks: process.env.ACTIVITYMAP_AUTH_JWKS!,
    },
  ],
};
```

- Each deployment (dev, production) gets the issuer and JWKS of the app
  environment that reads it. Rotation: publish the new public key alongside
  the old one in `ACTIVITYMAP_AUTH_JWKS`, rotate in the app, then drop the old
  key after the token lifetime (15 minutes).
- A new helper resolves the viewer for public functions:
  `ctx.auth.getUserIdentity()` → `subject` → `owners.by_user` → require
  `backend === 'convex'` and not revoked. Public functions take no `userId`
  argument. The owner epoch fences writers; reads follow the current
  assignment.

### Client

- `ConvexReactClient.setAuth(fetchToken)` with
  `fetchToken = async () => (await authClient.token()).data?.token ?? null`.
  The Convex client refreshes the token before it expires.
- No Next.js proxy: the browser talks to the Convex deployment directly.

## 2. Public queries (`backend/convex/library.ts`)

All derive the owner from `ctx.auth`, reuse the existing projection code and
never read `ownerHeads`, which changes on every write and would re-run every
subscription.

| Query               | Returns                                                         | Notes                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library.list`      | Paginated activity cards, ordered by activity ID                | `usePaginatedQuery`. Cards omit `map_polyline` (9.2 MB of the 13 MB of polylines in a 4,602-activity library); the map draws from `map_summary_polyline`. Pages hold about 200 cards so the first map render needs one round trip. |
| `library.activity`  | Full DTO (including `map_polyline`), streams metadata and match | For detail, GPX export and route framing.                                                                                                                                                                                          |
| `library.summaries` | Chart summaries for up to 100 IDs                               | Matches the existing summary contract.                                                                                                                                                                                             |
| `library.status`    | Ingestion counts                                                | Reads a per-owner `ownerStats` document that the write paths keep current in the same transaction, instead of scanning thousands of rows on every change.                                                                          |

Reactivity: a paginated subscription re-runs only the pages whose rows change,
so a rename re-sends one page, not the library. Card and detail shapes are
validated against the existing v1 contracts (minus `map_polyline` for cards).

Data-model additions: `ownerStats` (counts by geometry, stream and photo state,
oldest and newest start), maintained in `applySource`, `publishRecording`,
`publishMatch` and the catalogue rebuild, plus a backfill for existing owners.

## 3. Client wiring behind a flag

- A preview owner entry gains `live: true`
  (`{ "epoch": "…", "transport": "app", "live": true }`). The app shell passes
  `{ convexUrl }` to the client only for such owners.
- A `ConvexLibraryProvider` (mounted only then) subscribes to `library.list`,
  loads further pages until done, and feeds the existing activity store
  through the same entry points the sync controller uses today. Detail views
  call `library.activity`; charts use `library.summaries`; the status panel
  subscribes to `library.status`.
- The REST sync controller is not started for live owners. If the Convex
  client fails to authenticate or connect within a timeout, the app falls back
  to the REST bootstrap (which still serves the same owner through the bridge).
- Photos keep their current REST path.

## 4. Measurement and decision

Run on the dev deployment with the imported 4,602-activity library and on
production for the shadow owner once the first copy is complete:

- time to first map paint, time to full library, transferred bytes, and the
  number of round trips, cold and warm, for the REST bridge path and the live
  path (reusing the browser benchmark approach from the lab).
- update latency: Postgres change → mirror → visible in an open tab.

Decision rule: if the live path reaches first map paint well under 10 seconds
and full library within it on production, make it the web path for preview
owners and plan the cutover around it. If not, the numbers show whether the
remaining cost is payload (drop more fields, compress), query execution or
the client.

## 5. Delivery

1. Auth: `jwt` plugin with the `jwks` migration, Convex `auth.config.ts`, the
   viewer helper and a `library.whoami` query; tests with `convex-test`
   identities, plus a token round trip test against the plugin.
2. Queries: `library.*`, `ownerStats` with backfill, contract tests.
3. Client: provider, store wiring, fallback, behind `live: true`.
4. Measurement report and the decision above.

Each step is its own PR; nothing changes for users who are not listed as live
preview owners.

## Open questions

- Production issuer value and who holds the JWKS rotation step (Convex env
  variables are per deployment).
- Whether route framing and GPX can always wait for `library.activity`, or a
  few views need the detailed polyline up front.
- Whether live owners should keep the REST fallback permanently or only during
  measurement.
