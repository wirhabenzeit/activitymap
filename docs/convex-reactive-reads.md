# Convex auth and reactive reads (design)

Status: steps 1 to 3 are implemented (#505 merged; #507 and #508 open);
step 4, the measurement and decision, is open. Step 2 of the Convex migration
(follows shadow writes, #499). Tracks #496.

Sections 2 and 3 describe what was built. Where that differs from the first
proposal, "Changes from the proposal" at the end says how and why.

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
// backend/convex/auth.config.ts (abridged; implemented in #505)
const issuer = process.env.ACTIVITYMAP_AUTH_JWT_ISSUER;
export default {
  providers:
    issuer === 'disabled'
      ? []
      : [
          {
            type: 'customJwt',
            issuer,
            applicationID: 'convex',
            algorithm: 'ES256',
            // Static data URI of the app's public JWKS: no fetch per
            // validation, and no dependency on the app being reachable.
            jwks: process.env.ACTIVITYMAP_AUTH_JWKS,
          },
        ],
};
```

Convex refuses to deploy an auth config that reads an unset variable, so
every deployment sets `ACTIVITYMAP_AUTH_JWT_ISSUER`, to `disabled` until it is
wired to an app environment. The plugin's tokens carry no `typ` header;
Convex accepts them (verified on the dev deployment in #505).

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

- `ConvexClient` (`convex/browser`) with
  `setAuth(async () => (await authClient.token()).data?.token ?? null)`;
  `authClient.token()` comes from Better Auth's `jwtClient` plugin. The Convex
  client refreshes the token before it expires. The library is fed into the
  existing browser store, not rendered from query hooks, so the React client
  is not needed.
- No Next.js proxy: the browser talks to the Convex deployment directly.

## 2. Public queries (`backend/convex/library.ts`)

All derive the owner from `ctx.auth`, take no user argument and reuse the
existing projection code. Only `changes` reads `ownerHeads`, which changes on
every write; the others would otherwise re-run on every write anywhere in the
library.

| Query               | Returns                                                                    | Notes                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library.list`      | Paginated activity cards, ordered by activity ID                           | Cards omit `map_polyline` (9.2 MB of the 13 MB of polylines in a 4,602-activity library); the map draws from `map_summary_polyline`. A page holds up to 256 cards and stops early at the read budget (see below). |
| `library.changes`   | Changes after a sequence: current cards, deleted IDs, the next position    | Collapsed per activity; at most 256 change entries and 32 distinct activities per read. Answers `reload` without a usable position. Every result carries the library version.                                     |
| `library.activity`  | Full DTO (including `map_polyline`), streams metadata and match, or `null` | Used by GPX export.                                                                                                                                                                                               |
| `library.summaries` | Chart summaries and stream metadata for up to 32 IDs                       | Shares its code with the bridge's summaries operation.                                                                                                                                                            |
| `library.status`    | Ingestion counts, oldest and newest activity                               | Counts come from a per-owner `ownerStats` document; `ready: false` while it is being rebuilt or has never been built.                                                                                             |

Read budget: Convex limits the data one transaction reads to 16 MiB, counted
on whole documents, and an activity document can hold about 256 KiB. Leaving
`map_polyline` out of a response does not reduce what is read. Functions that
read many activities therefore stay within about half the limit: paginated
scans stop after 6 MiB (`maximumBytesRead`), so a page can be shorter than
requested and continues from `continueCursor`; reads by ID take at most 32
activities with their recordings.

`library.changes` returns `reload` with the head sequence when the caller has
no position, when the position is below the retention floor (compacted
history), or when it is beyond the head. The library version combines the
owner epoch, generation, matching version and projection versions: a client
holding cards from another version loads the library again.

Card and detail shapes are validated against the existing v1 contracts (minus
`map_polyline` for cards).

Data-model additions:

- `ownerStats`: counts by geometry, stream and photo state, with the same
  fields as the bridge's status operation. `applySource` and recording
  publication apply a before/after delta in the same transaction and skip
  writes that change no count. Match publication and the catalogue rebuild
  change no count. New owners start at zero; existing owners need one
  `stats:rebuild`, which recounts in bounded steps while writes keep the
  counts consistent. A change to `PROJECTION_VERSION` changes what rows
  contribute and needs a rebuild too.
- `by_owner_live_start`, an index on `dto.start_date`, for the oldest and
  newest activity.

## 3. Client wiring behind a flag

- A preview owner entry gains `live: true`
  (`{ "epoch": "…", "transport": "app", "live": true }`). The app shell passes
  the Convex URL (`currentUser.convexLive`) to the client only for such
  owners.
- The browser library store (IndexedDB) is the cache. It keeps the Convex
  change-feed position its cards are current to (sequence and library
  version).
  - Normal load: read `library.changes` from the stored position. The cached
    library is usable at once and only what changed since is transferred. One
    subscription to `changes` then carries new changes while the page is open.
  - First load or `reload`: read the head sequence, then the library once
    through `library.list` (one-shot reads, no page subscriptions), drop rows
    Convex no longer has, store the head position and follow the feed from
    there. Changes made while the pages were read arrive through the feed
    again; applying them twice is harmless because each carries the
    activity's current card.
- Each batch and its position commit in one IndexedDB transaction, through
  the same serialized library writer that REST downloads and edit responses
  use, so account cleanup fences live writes too. Committed batches are
  reported to the chart cache like REST changes.
- The map, list and stats read the same library snapshot as before.
- GPX export fetches `library.activity` for the detailed polyline.
- The REST sync is not started for live owners. If Convex rejects the token,
  a query fails or the library is not usable within 20 seconds, the app falls
  back to the REST sync (which still serves the same owner through the
  bridge). Live and REST do not resume from each other's state: either one
  starts with a full load after the other has written.
- Not moved yet: chart summaries and the status panel keep their REST routes;
  `library.summaries` and `library.status` exist but have no client. Photos
  keep their current REST path.

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

Numbers so far, all from the dev deployment with the 4,602-activity library
(none from production, none from a browser benchmark):

- Payload: 13.5 MB as cards (18 pages of 256) against 23.1 MB of full DTOs in
  the REST bootstrap, before compression (#507).
- Full load in Node, with an earlier page-subscription client: first page in
  1.3 s and all activities in 8.5 s, against 14.5 s for the REST bridge
  bootstrap; a rename was pushed in 1.4 s (#508).
- Warm load in a browser: only `changes` is read, no `list` page (#508).

Update latency is bounded by the mirror, which runs every ten minutes (#502):
the live path shortens loading, not the time for a Postgres change to appear.

## 5. Delivery

1. Auth (#505, merged): `jwt` plugin with the `jwks` migration, Convex
   `auth.config.ts`, the viewer helper and a `library.whoami` query; tests
   with `convex-test` identities, plus a token round trip test against the
   plugin.
2. Queries (#507, open): `library.list`, `activity`, `summaries` and `status`,
   `ownerStats` with its rebuild, contract and read-limit tests.
3. Client (#508, open, stacked on #507): `library.changes`, the live session,
   store wiring and fallback, behind `live: true`.
4. Measurement report and the decision above (not started).

Each step is its own PR; nothing changes for users who are not listed as live
preview owners.

Enabling an environment: apply migration `0030` and set
`ACTIVITYMAP_AUTH_JWT_ISSUER` in the app; set `ACTIVITYMAP_AUTH_JWKS`, then
the same issuer, on the matching Convex deployment; run `stats:rebuild` for
each existing owner; set `ACTIVITYMAP_CONVEX_URL` in the app and add
`"live": true` to the owner's preview entry.

## Changes from the proposal

- **Change feed instead of page subscriptions.** The proposal subscribed to
  every `library.list` page with `usePaginatedQuery`. That transfers the whole
  library on every load and keeps one subscription per page open. With the
  browser store as the cache and `library.changes`, a warm load transfers
  only what changed and keeps one subscription. The cost is that `changes`
  reads `ownerHeads` and re-runs on every write for the owner; an unchanged
  re-run delivers nothing.
- **Read budgets.** Pages were planned at about 200 cards and summaries at
  100 IDs. Both could exceed the 16 MiB read limit with large activities, so
  pages stop at a byte budget and summaries take 32 IDs.
- **`ownerStats` writers.** Only `applySource` and recording publication
  maintain the counts; match publication and the catalogue rebuild were listed
  but change no count.
- **Detailed polyline.** Only GPX export needs it; route framing already
  prefers the summary polyline.
- **Summaries and status.** Still on REST for live owners.

## Open questions

- Production issuer value and who holds the JWKS rotation step (Convex env
  variables are per deployment).
- Whether live owners should keep the REST fallback permanently or only during
  measurement. A fallback costs a full REST bootstrap, and the next live load
  is a full reload.
- When to move chart summaries and the status panel to `library.summaries`
  and `library.status`.
- Whether the mirror interval is acceptable for live owners, or changes need
  to reach Convex sooner.
