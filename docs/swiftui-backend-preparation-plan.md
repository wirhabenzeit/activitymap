# SwiftUI Backend Preparation Plan

## Objective

Prepare the existing Next.js application to support a native SwiftUI client
without replacing the web application or duplicating business logic.

The target is a local-first iOS client that:

- authenticates with Strava through the existing server;
- stores only an ActivityMap session token in the iOS Keychain;
- reads activities and photo metadata from a local SQLite database;
- obtains bootstrap and incremental changes from a versioned HTTP API;
- never receives Strava access tokens, refresh tokens, database credentials, or
  raw Better Auth account records;
- can remain useful offline within the retention limits that apply to Strava
  data.

## Executive decision

Keep Next.js and Neon as the backend for both clients.

Introduce three explicit layers inside the existing application:

1. **Contracts**: versioned, transport-safe request and response schemas.
2. **Application services**: authorization-aware use cases that contain no
   React, `next/headers`, Server Action, or Route Handler code.
3. **Transport adapters**: Route Handlers for web/mobile HTTP clients and, where
   still useful, Server Actions for the React UI.

This is a normal Backend-for-Frontend use of Next.js, not a framework
anti-pattern. The important constraint is that server-rendered React code should
continue calling application services directly rather than making HTTP requests
back into its own Route Handlers.

## Target architecture

```text
                        Strava OAuth and webhooks
                                  |
                                  v
                  +--------------------------------+
                  | Next.js Route Handlers         |
                  | - /api/auth/...                |
                  | - /api/strava/webhook          |
                  | - /api/v1/...                  |
                  +---------------+----------------+
                                  |
                                  v
                  +--------------------------------+
                  | Application services           |
                  | - identity and authorization   |
                  | - activity read/write          |
                  | - Strava synchronization       |
                  | - change-feed generation       |
                  +---------------+----------------+
                                  |
                                  v
                           Neon/Postgres
                         /                \
                        v                  v
             React web client       SwiftUI client
             IndexedDB cache        SQLite cache
```

Suggested code layout:

```text
src/
  contracts/v1/
    activity.ts
    auth.ts
    errors.ts
    sync.ts
  server/
    application/
      activities.ts
      sync.ts
      strava.ts
    auth/
      actor.ts
      mobile.ts
    repositories/
      activities.ts
      changes.ts
      photos.ts
    jobs/
      strava-events.ts
  app/api/v1/
    me/route.ts
    sync/bootstrap/route.ts
    sync/changes/route.ts
    activities/[id]/route.ts
    activities/[id]/refresh/route.ts
```

This layout can be introduced incrementally. A monorepo or a separate backend
deployment is not required before the native app begins.

## Current findings to address first

### 1. Strava credentials cross the server/client boundary

The root layout puts the complete database `Account` record into client auth
state. Client components then send `account.access_token` back to Server
Actions. Because the account schema contains access and refresh tokens, these
credentials can be serialized into the browser response.

Required correction:

- replace the client-visible account with a safe `CurrentUserDTO`, such as
  `{ id, name, image, athleteId, stravaConnected }`;
- remove all Strava token and account-ID parameters from public Server Actions;
- resolve the current user and their Strava account inside the server service;
- add a regression test that serialized page/API responses never contain token
  fields.

This work is independent of SwiftUI and should be the first implementation PR.

### 2. A session credential is accepted in a query string

`/api/db` accepts `?session=...` and logs the supplied token and session.
Credentials in URLs can appear in browser history, analytics, proxy logs, and
server logs.

Required correction:

- remove query-string session authentication;
- accept only the normal secure cookie or an `Authorization: Bearer` header;
- redact authentication headers, tokens, and personal activity data from logs.

### 3. Server Actions are being used as the data API

The web hooks call `getUserActivities` and `getPhotos` as Server Actions, and
client components call Strava synchronization actions directly. This works for
the React client but is not a stable or portable API for SwiftUI. It also causes
data-fetching Server Actions to be dispatched sequentially.

Required correction:

- move the underlying logic into application services;
- let Route Handlers and Server Actions call the same services;
- migrate browser-side reads to `/api/v1` where doing so dogfoods the native
  contract;
- retain Server Actions for web-only form integration when they remain useful.

### 4. The current delta cursor is not lossless

The offline API uses a timestamp cursor with a strict `>` comparison. Multiple
changes can share the same timestamp, so a client can miss rows at a page or
request boundary. Bootstrap is also unpaginated.

Required correction:

- introduce a monotonically increasing change sequence;
- make cursors opaque and versioned;
- paginate bootstrap using stable keyset pagination;
- return a snapshot high-water mark and then apply changes after that mark;
- retain a periodic full-reconciliation path.

### 5. Webhook processing is duplicated and synchronous

There are two Strava webhook routes and two webhook table representations. The
newer route explicitly performs Strava fetches and database updates before
returning its response.

Required correction:

- select one canonical `/api/strava/webhook` route;
- validate and durably record each event, then respond quickly;
- process recorded events in a retryable worker or scheduled drain;
- enforce idempotency with a database uniqueness constraint;
- maintain attempt count, next-attempt time, last error, and dead-letter state;
- make activity upserts, deletions, tombstones, and change-sequence entries
  transactional.

### 6. Strava retention rules affect the offline design

The current Strava API Policy limits cached Strava data to seven days and
requires deleted data to stop being displayed within 48 hours. This should be
confirmed for the intended product and encoded as an explicit retention policy,
not left as an implementation detail.

Required correction:

- record `lastValidatedAt` and `expiresAt` for cached datasets;
- require a refresh or purge after the permitted cache window;
- process delete and deauthorization webhooks with high priority;
- make the iOS app refuse to display expired Strava-derived data until it has
  been refreshed, if that is the policy interpretation adopted for the product;
- review the existing public sharing behavior against the current policy before
  exposing it in the native client.

## API design

### General rules

- Base path: `/api/v1`.
- JSON fields use stable API names and do not mirror Drizzle column names by
  accident.
- Dates use ISO 8601 strings in UTC. A separate local date/timezone is included
  where required for activity presentation.
- IDs that may exceed JavaScript's safe integer range are encoded as strings.
- Every list endpoint has keyset pagination and an explicit maximum page size.
- Every response that changes local state contains `schemaVersion` and
  `serverTime`.
- Error responses use a stable envelope:

```json
{
  "error": {
    "code": "not_authenticated",
    "message": "Authentication is required.",
    "retryable": false,
    "requestId": "..."
  }
}
```

- Responses never contain Drizzle model objects directly.
- Contract schemas are tested at the Route Handler boundary.
- An OpenAPI 3.1 document is generated or maintained from the same contracts.
  The Swift client can use Apple's Swift OpenAPI Generator so its Codable types
  and request methods remain synchronized with the server contract.

### Initial endpoint set

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/me` | Safe current-user and connection status |
| `GET` | `/api/v1/sync/bootstrap` | Paginated local database bootstrap |
| `GET` | `/api/v1/sync/changes` | Ordered activity/photo upserts and deletions |
| `GET` | `/api/v1/activities/{id}` | Fetch one complete activity DTO |
| `PATCH` | `/api/v1/activities/{id}` | Update fields in Strava and local storage |
| `POST` | `/api/v1/activities/{id}/refresh` | Explicitly refetch one activity and photos |
| `POST` | `/api/v1/auth/mobile/exchange` | Exchange a one-use mobile login code |
| `POST` | `/api/v1/auth/logout` | Revoke the current ActivityMap session |

Bulk repair, administrative synchronization, public sharing, and CSV export do
not need to be part of the first native API.

## Authentication design

Browser authentication remains cookie based. Mobile API requests use an
ActivityMap bearer session stored in the iOS Keychain. The mobile app never
receives a Strava token.

Recommended flow:

1. SwiftUI generates a random state value and a PKCE verifier/challenge for the
   ActivityMap login exchange.
2. `ASWebAuthenticationSession` opens an ActivityMap mobile-auth start URL.
3. ActivityMap starts the existing server-side Strava OAuth flow.
4. Strava redirects to the ActivityMap backend, where the client secret is used
   and the Strava tokens remain server-side.
5. ActivityMap redirects to an allow-listed universal link containing a
   short-lived, one-use authorization code and the original state value.
6. SwiftUI exchanges that code plus the PKCE verifier at
   `/api/v1/auth/mobile/exchange`.
7. The server returns an ActivityMap session token. SwiftUI stores it in the
   Keychain and sends it in the `Authorization` header.

Implementation choices to spike before committing:

- Prefer reusing Better Auth sessions with its Bearer plugin if the complete
  redirect and one-time exchange flow can be implemented without exposing a
  session token in a URL.
- Otherwise add a small mobile-session table with hashed, rotating refresh
  tokens, explicit device/session revocation, and short-lived access tokens.

In both cases, a single helper should resolve a request to an authenticated
actor from either a browser cookie or a bearer header:

```ts
type Actor = {
  userId: string;
  athleteId: number;
  authentication: 'cookie' | 'bearer';
};
```

Application services receive `Actor`; they do not inspect cookies or headers.

## Synchronization protocol

### Database additions

Add an append-only change feed, for example:

```text
sync_change
  sequence           bigint generated always as identity
  user_id            text
  entity_type        activity | photo
  entity_id          text
  operation          upsert | delete
  changed_at         timestamp
```

All entity mutations and their change record must commit in the same database
transaction. A uniqueness or coalescing strategy may reduce repeated changes,
but the sequence itself must remain strictly ordered.

### Bootstrap

1. The first page returns a `snapshotCursor` representing the current change
   high-water mark.
2. Activities and photos are returned with stable keyset pagination, never
   offset pagination.
3. The client applies each page to SQLite in a transaction.
4. After the final page, the client requests changes after `snapshotCursor` to
   catch events that occurred during bootstrap.

### Delta synchronization

1. SwiftUI sends its last opaque change cursor.
2. The server returns a bounded ordered page of changes plus the next cursor.
3. SwiftUI applies upserts and deletions in one SQLite transaction.
4. SwiftUI advances its cursor only after the transaction commits.
5. The operation is safe to replay after interruption.

If a cursor is too old, unsupported, or beyond the retained change history, the
server returns `409 sync_rebootstrap_required` rather than silently returning an
incomplete result.

### Local-client behavior

- SQLite is the only source read by SwiftUI views.
- Network responses update SQLite; they do not feed views directly.
- Activity metadata, photo metadata, downloaded photo files, and Mapbox offline
  regions have separate storage and expiry policies.
- Map tile downloads are not part of the ActivityMap API synchronization
  protocol.

## Web application integration

The React application should not be forced through the public API everywhere.
Use the following rule:

- **Server Component or server layout:** call an application service directly.
- **Client Component needing portable data:** call `/api/v1` through a typed web
  client.
- **React-specific form mutation:** a Server Action may call the same
  application service directly.
- **SwiftUI:** call `/api/v1` only.

This avoids an internal HTTP round trip during server rendering while still
ensuring that web client paths exercise the same API used by SwiftUI.

The current `useActivities` and `usePhotos` hooks are good candidates to migrate
to the versioned sync API after it is stable. Existing Server Actions can remain
as compatibility adapters during rollout.

## Implementation phases

### Phase 0: Security and policy gate

Estimated effort: 2–4 developer days.

- Stop serializing database account records into the browser.
- Remove client-supplied Strava access tokens and athlete/account IDs.
- Remove query-string session authentication from `/api/db`.
- Redact sensitive logs.
- Confirm the Strava retention and sharing interpretation.
- Inventory and normalize the duplicated legacy/Better Auth account token
  columns before building mobile auth on them.

Exit criteria:

- browser network responses contain no Strava tokens;
- all Strava calls derive identity and credentials server-side;
- no credential is accepted in a URL;
- the retention decision is recorded.

### Phase 1: Application service boundary and contracts

Estimated effort: 3–5 developer days.

- Create safe v1 DTOs and Zod schemas.
- Extract activity reads, updates, refreshes, and sync queries from Server
  Actions into application services.
- Introduce the cookie-or-bearer `Actor` resolver.
- Define the OpenAPI document and add contract validation tests.
- Keep existing Server Actions as thin adapters to avoid a big-bang web change.

Exit criteria:

- application services have no React or request-global dependencies;
- Route Handlers and Server Actions can invoke the same service;
- a Swift client can be generated from the API document.

### Phase 2: Mobile authentication

Estimated effort: 4–7 developer days, including an iOS proof of concept.

- Add bearer-session support.
- Implement the state-, PKCE-, and one-time-code mobile callback flow.
- Add allow-listed universal links and reject open redirects.
- Store only hashed/revocable server-side session credentials.
- Add logout and per-device session revocation.
- Build a minimal Swift command-line or test-app client that completes login and
  calls `/api/v1/me`.

Exit criteria:

- a fresh iOS installation can sign in and call an authenticated endpoint;
- the Keychain contains an ActivityMap credential, not a Strava credential;
- replayed or expired exchange codes fail.

### Phase 3: Lossless versioned sync API

Estimated effort: 5–8 developer days.

- Add the ordered change feed and migrations.
- Write change entries for every activity/photo upsert and delete.
- Implement paginated bootstrap and delta endpoints.
- Add cursor versioning, rebootstrap responses, schema versioning, and expiry
  metadata.
- Add full-reconciliation support.
- Generate the Swift API client and prove bootstrap into a temporary SQLite
  database.

Exit criteria:

- concurrent changes during bootstrap are not lost;
- sync is idempotent and resumes after interruption;
- deletion propagation is covered by integration tests.

### Phase 4: Durable webhook ingestion

Estimated effort: 3–6 developer days.

- Consolidate the duplicate webhook routes and tables.
- Add an idempotent webhook-event inbox table.
- Return promptly after durable insertion.
- Process jobs with retries, backoff, and dead-letter state.
- Prioritize deletion and athlete-deauthorization events.
- Add a scheduled reconciliation safety net.

Exit criteria:

- duplicate webhook deliveries do not produce duplicate mutations;
- transient Strava/database failure is retried;
- route duration no longer depends on Strava API latency.

### Phase 5: Web adoption and compatibility cleanup

Estimated effort: 3–5 developer days.

- Move `useActivities` and `usePhotos` onto the v1 API/change feed.
- Replace web IndexedDB DTO imports from Drizzle schema with v1 contracts.
- Move update and refresh UI calls to safe adapters that never accept tokens.
- Remove legacy Server Actions and webhook code only after parity is verified.
- Preserve direct service calls from server-rendered code.

Exit criteria:

- web and iOS consume the same data contract;
- the existing web experience and offline cache continue to work;
- no server code relies on client-provided ownership or provider credentials.

### Phase 6: Hardening and native-client readiness

Estimated effort: 3–5 developer days.

- Add per-session and per-user API rate limits.
- Add request IDs, structured redacted logs, job metrics, and sync lag metrics.
- Add OpenAPI compatibility checks in CI.
- Test large accounts, pagination, token expiry, revoked Strava access, stale
  mobile cursors, and seven-day offline expiry.
- Write the operational runbook for webhook backlog and forced rebootstrap.

Exit criteria:

- the backend has a documented compatibility and deprecation policy;
- an iOS client can be released without relying on undocumented web behavior.

## Test strategy

The repository currently has no application test suite beyond a webhook shell
script. Add tests alongside the migration instead of waiting for the end.

Minimum coverage:

- DTO serialization never emits account/token fields.
- Cookie and bearer auth produce the same actor and ownership checks.
- Users cannot fetch or mutate another athlete's records.
- Malformed and oversized request bodies fail predictably.
- Bootstrap pagination survives inserts and deletes between pages.
- Equal-timestamp mutations cannot be lost.
- Replaying a change page is harmless.
- Webhook duplicates, out-of-order events, and transient failures are handled.
- Deletions create both tombstones and change-feed entries transactionally.
- Expired/revoked sessions and stale sync cursors return stable error codes.
- The checked-in OpenAPI document generates and compiles the Swift client.

## Rollout strategy

1. Deploy Phase 0 without changing the browser UX.
2. Add `/api/v1` alongside existing Server Actions.
3. Exercise `/api/v1` from integration tests and one web hook before SwiftUI
   depends on it.
4. Release a read-only SwiftUI prototype: login, bootstrap, local list, and map.
5. Add delta sync and webhook-driven freshness.
6. Add native mutations only after read synchronization is stable.
7. Deprecate old endpoints with metrics and a defined removal date.

No database migration should remove old columns or feeds in the same deployment
that introduces their replacements. Use expand, backfill, switch, and contract
deployments.

## Estimated scope

A minimal backend slice sufficient to start a read-only SwiftUI prototype is
approximately **12–18 developer days**:

- security corrections;
- service/contract boundary;
- mobile authentication;
- paginated bootstrap.

The full preparation described above is approximately **23–40 developer days**,
or roughly **5–8 weeks for one developer**, depending mainly on mobile OAuth,
webhook job infrastructure, test fixtures, and the retention-policy decision.

These estimates exclude SwiftUI screen implementation, Mapbox offline-region
UX, App Store work, and production privacy/legal review.

## What would be an anti-pattern

The proposed API itself is not an anti-pattern. The following implementations
would be:

- making Server Components call the application's own public HTTP API;
- treating Server Actions as the native API contract;
- returning Drizzle rows directly and making database migrations API-breaking;
- allowing mobile clients to submit athlete IDs, account IDs, or Strava tokens;
- connecting the native app directly to Postgres;
- performing long-running webhook synchronization in the request handler;
- sharing one unversioned DTO between persistence, web UI state, and SwiftUI;
- extracting a standalone backend before deployment or scaling requirements
  justify the additional service boundary.

## References

- [Next.js Backend for Frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Better Auth bearer-token plugin](https://better-auth.com/docs/plugins/bearer)
- [Swift OpenAPI Generator](https://github.com/apple/swift-openapi-generator)
- [Strava authentication](https://developers.strava.com/docs/authentication/)
- [Strava webhooks](https://developers.strava.com/docs/webhooks/)
- [Strava API Policy](https://www.strava.com/legal/api_policy)
