# iOS Data Ingestion Plan

## Objective

Replace `SampleData` in the SwiftUI client with real activity and photo data
from an ActivityMap deployment, by adding two layers to the iOS app:

1. a **local persistent store** that is the only thing the views read;
2. a **sync engine** that speaks the existing `/api/v1` cursor protocol and is
   the only thing that writes to that store.

This document covers the iOS side only. It assumes the contract and server
behaviour already described in
[`swiftui-backend-preparation-plan.md`](swiftui-backend-preparation-plan.md) and
does not restate them.

## What already exists

The backend work this depends on is largely done, so iOS ingestion is not
blocked on server development.

| Capability | Status | Location |
| --- | --- | --- |
| Safe current-user endpoint | Implemented | `src/app/api/v1/me/route.ts` |
| Paginated bootstrap | Implemented | `src/app/api/v1/sync/bootstrap/` |
| Ordered change feed | Implemented | `src/app/api/v1/sync/changes/` |
| Activity and photo lists | Implemented | `src/app/api/v1/{activities,photos}/route.ts` |
| Mobile PKCE login + exchange | Implemented | `src/app/api/v1/auth/mobile/` |
| Logout and per-session revocation | Implemented | `src/app/api/v1/auth/{logout,sessions}/` |
| Rate limits, request IDs, redacted logs | Implemented | `src/server/api/`, `src/server/logging/` |
| Durable webhook inbox and cron drains | Implemented | `src/app/api/cron/`, `src/app/api/strava/webhook/` |
| Wire contracts | Implemented | `src/contracts/v1/` |
| OpenAPI 3.1 document | Committed | `openapi/v1.json` |

Two things make the iOS work considerably smaller than it looks.

**There is already a working reference implementation of the exact protocol we
need, in TypeScript.** The web client was migrated onto the same v1 sync API:

- `src/lib/sync/v1-client.ts` — envelope/error decoding, page fetching, and the
  `drainSyncBootstrap` / `drainSyncChanges` paging loops;
- `src/lib/sync/v1-sync.ts` — the full orchestration (`runV1Sync`): bootstrap on
  first run, `/sync/changes` catch-up afterwards, single retry on
  `409 sync_rebootstrap_required`;
- `src/lib/sync/v1-store.ts` — the scoped local cache;
- `src/lib/sync/v1-mappers.ts` — DTO to view-model mapping.

All four have unit tests. The Swift sync engine should be a deliberate,
close port of `v1-sync.ts` rather than a fresh design, so that one protocol has
one set of semantics across both clients and the tests can be mirrored.

**Authentication is integrated.** `Auth/AuthController.swift` handles PKCE,
`ASWebAuthenticationSession`, exchange, Keychain storage, restoration and
revocation through the shared `APIClient`. The account sheet displays the real
`/api/v1/me` response, and sign-in has been exercised against the local server.

## The iOS client does not talk to the database

Worth stating explicitly, because "wire in the dev/prod database" is the natural
way to describe the goal: the app must never hold a Postgres connection, a Neon
credential, or a Strava token. Connecting the native app directly to Postgres is
on the plan doc's anti-pattern list.

"Dev versus prod" on iOS therefore means *which deployment the app points at*,
and the database follows from that deployment's own configuration per the
[environment matrix](environment-and-database-rollout.md#target-environment-matrix):

| iOS build configuration | API base URL | Resulting database | Native sign-in |
| --- | --- | --- | --- |
| Debug (local) | `http://localhost:3000` | Docker Postgres via local `DATABASE_URL` | Yes, once external effects and Strava credentials are configured |
| Debug (preview) | The Vercel preview URL | That preview's dedicated Neon branch | **No** — build and read-only inspection only |
| Release | The production URL | Neon production branch | Yes |

Preview cannot authenticate, and this is deliberate rather than a gap to close.
Preview deployments run with `ACTIVITYMAP_EXTERNAL_EFFECTS` disabled, and
`src/lib/auth.ts` only registers the Strava `genericOAuth` provider when
external effects are enabled. A Preview therefore has no Strava provider at all,
so the mobile flow has nothing to redirect to. Treat Preview as unauthenticated
and build-only; use an explicitly configured local server for end-to-end
authentication, or stand up the optional staging deployment from the
environment matrix if a hosted authenticated target is ever needed.

Local sign-in needs more than the redirect allow-list. It also needs
`ACTIVITYMAP_EXTERNAL_EFFECTS=enabled` plus `AUTH_STRAVA_ID`,
`AUTH_STRAVA_SECRET`, and the Better Auth values, and enabling external effects
means the local server makes real Strava API calls — see the iOS README for the
full list and that caveat.

The only credential on the device is an ActivityMap bearer session token in the
Keychain.

## Recommended persistence layer: SwiftData

The question in the original ask was Core Data "or something like that". The
recommendation is **SwiftData**, for reasons specific to this protocol rather
than general preference.

- Unique keys include deployment, user and entity ID. `LocalStore` explicitly
  updates existing rows, including repeat operations within the same page.
- `LocalStore` is an actor that creates a fresh context per operation, so model
  objects never cross an actor boundary and reads see committed data.
- `ModelContext.save()` is the transactional unit the protocol requires (see
  "The cursor rule" below). Core Data offers the same guarantee, but SwiftData
  expresses it with far less ceremony.
- The deployment target is already iOS 27, so none of the historical reasons to
  prefer Core Data for compatibility apply.

Honest trade-offs to accept:

- SwiftData has no equivalent of `NSBatchInsertRequest`. Bootstrap inserts row
  by row inside the model actor. Mitigation: bootstrap already arrives in pages
  of 100–500 (`DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` in
  `src/contracts/v1/pagination.ts`), so we insert and save one page at a time.
  For realistic account sizes this is fine; if profiling on a large account says
  otherwise, the escape hatch is Core Data behind the same `LocalStore` facade,
  which is why the facade exists.
- Predicate support is narrower than raw SQL. This does not bite us, because
  the app filters in memory today (`ActivityStore.filteredActivities`) and
  should continue to — see "Reading path" below.

GRDB or hand-rolled SQLite would give more control over bulk writes, but adds a
dependency and hand-written migrations to buy something the current dataset
size does not need.

## Proposed module layout

New directories inside `ios/ActivityMap/ActivityMap/`. The Xcode project uses
file-system synchronized groups, so files added on disk join the target
automatically — no `project.pbxproj` editing.

```text
Networking/
  APIConfiguration.swift     // base URL + schema version, read from Info.plist
  APIClient.swift            // envelope unwrapping, bearer injection, error mapping
  SyncAPI.swift              // bootstrap/changes page fetches + drain loops
  DTO/
    ActivityMapAPI.generated.swift   // Codable mirrors of src/contracts/v1
    APISupport.swift                 // Envelope<T>, Page<T>, JSONValue, decoder
Auth/
  AuthController.swift       // PKCE + ASWebAuthenticationSession (from the test client)
  SessionStore.swift         // Keychain read/write/clear
Persistence/
  StoreScope.swift           // deployment + authenticated user identity
  StoreCodec.swift           // internal Codable format preserving Date precision
  StoredActivity.swift       // @Model: unique scoped key, ID, DTO payload
  StoredPhoto.swift          // @Model: unique scoped key, parent activity ID, DTO payload
  SyncState.swift            // @Model: scope + encoded SyncCheckpoint
  LocalStore.swift           // actor: the only reader/writer of SwiftData models
Sync/
  SyncEngine.swift           // port of src/lib/sync/v1-sync.ts
  SyncStatus.swift           // @Observable surface for the UI
Support/
  Polyline.swift             // Google encoded-polyline decoder, precision 5
```

`Models/Activity.swift` and `Models/ActivityStore.swift` stay where they are and
keep their current shape; only where their data comes from changes.

## The DTO layer

Implemented: `pnpm api-dtos:generate` emits
`ios/ActivityMap/ActivityMap/Networking/DTO/ActivityMapAPI.generated.swift` from
the Zod contracts, and `pnpm api-dtos:check` fails CI on drift — the same pattern
as `pnpm map-catalog:generate` / `:check`.

The chain is Zod to JSON Schema to Swift, reusing the identical
`z.toJSONSchema` projection that `src/contracts/v1/openapi.ts` already uses to
build `openapi/v1.json`. There is no hand-maintained description of the contract
anywhere in between, so a schema change either regenerates or fails CI.

Decisions worth knowing when reading the generated file:

- Types are nested in an `ActivityMapAPI` namespace, because the app already has
  its own `Activity` and `SportType`. Keeping wire types and view models
  visibly distinct is useful: the mapper between them is the one place where id
  and date handling is pinned down.
- Registering a schema in the generator's list is what fixes its Swift name;
  registered schemas become `$ref`s, and inline string enums must be named
  explicitly in `inlineEnumNames` or generation fails rather than inventing a
  name.
- Generic wrappers are not generated. `responseEnvelope(T)` and
  `paginatedSchema(T)` project to a distinct concrete schema per instantiation,
  so they are hand-written once as `ActivityMapAPI.Envelope<Payload>` and
  `ActivityMapAPI.Page<Item>` in `APISupport.swift`, alongside `JSONValue` and
  the date-tolerant decoder.
- `additionalProperties: false` is intentionally not enforced. Swift's
  `Decodable` ignores unknown keys, so an older build keeps working against a
  server that has added a field.
- JSON Schema cannot express `superRefine`, so `SyncChangeItem`'s "an upsert
  carries its entity, a delete carries none" rule is absent from the generated
  type and stays the sync engine's responsibility.
- Everything is `nonisolated`, because the target defaults to `MainActor`
  isolation and the sync engine decodes off the main actor.

The two alternatives were considered and are weaker here:

- **`@openapitools/openapi-generator-cli -g swift6`** is already run by
  `scripts/verify-swift-client.sh` in CI (`ci.yml:40`), but only to prove the
  document generates a package that compiles. Its output is verbose and is not
  wired into the app target.
- **Apple's swift-openapi-generator** is the nicer long-term option and is what
  the backend plan names, but it is a SwiftPM build-tool plugin, which means
  restructuring the app into a package or accepting plugin configuration in the
  app target. Worth revisiting once the app has a package boundary.

`openapi/v1.json` remains authoritative for external consumers and for
`pnpm openapi:check-breaking`.

## The cursor rule

This is the one correctness property that must not be compromised, and it drives
the shape of `LocalStore`.

`SyncState`, `StoredActivity` and `StoredPhoto` share one store.
`LocalStore.apply(_:checkpoint:scope:)` applies ordered mutations and the
checkpoint in one explicit `ModelContext.save()`. Autosave is disabled; any
error rolls back the context. A nil checkpoint leaves sync state unchanged
while incomplete bootstrap pages are accumulated. Network code must reject
malformed changes before constructing mutations, never skip them and advance
the cursor.

If the process dies mid-page, nothing commits and the next run replays the same
cursor. The protocol is explicitly designed for that replay to be harmless.

Note the activity-delete branch deletes the activity's photos too. The web
client does the same (`deletePhotoDTOsByActivityIds` in `v1-sync.ts`), because a
cascade delete on the server does not necessarily emit a separate tombstone per
photo. Omitting it leaves orphaned photo rows.

## Sync engine

A direct port of `runV1Sync`. The state machine, in full:

1. Read `SyncState` for the current scope (deployment URL and authenticated
   user ID; session rotation does not change the scope).
2. No completed bootstrap, or no cursor? **Fresh bootstrap**: clear the scope
   first (a failed earlier bootstrap can leave rows without a state record, and
   rows deleted between attempts would otherwise survive as ghosts), drain
   `resource=activities` to exhaustion, then `resource=photos`, then immediately
   drain `/sync/changes` from the `snapshotCursor` the activities' first page
   returned. That final catch-up is not optional — the snapshot cursor is
   captured before the pages are read, so concurrent mutations land in the gap.
3. Otherwise **catch up**: drain `/sync/changes` from the stored cursor until a
   page comes back empty.
4. On `409 sync_rebootstrap_required`, clear the scope and run one fresh
   bootstrap. Exactly one — a second 409 in the same pass indicates a server
   bug and should surface as an error rather than loop.

Two defensive details to carry over from `v1-client.ts`: treat an empty
`items` array as "caught up, not finished" (the change feed never terminates),
and bail out if a non-empty page returns a `nextCursor` equal to the one just
sent, so a server bug cannot spin the device.

Trigger points: after login, on `scenePhase` becoming active, on manual pull to
refresh, and on a modest foreground interval. `BGAppRefreshTask` can come later;
it is not needed for a first usable client.

## Reading path

The views should keep reading in-memory `Activity` values through
`ActivityStore`. The change is that `ActivityStore` is populated from
`StoredActivity` instead of `SampleData`, via a mapper that mirrors
`v1-mappers.ts`.

Deliberately *not* recommended for now: `@Query` directly in the views. The
filter panel composes seven independent, individually-optional predicates over
sport type, date range, distance, elevation, duration, and commute, and the
stats screen aggregates across the whole filtered set. That is a poor fit for
`#Predicate` and a good fit for the array filtering already written and working.
Load once into memory, re-load when a sync pass reports it changed something.

Revisit only if an account's dataset outgrows memory.

## Geometry

The DTO carries `map_polyline` and `map_summary_polyline` as Google
encoded-polyline strings; `Activity` holds `[CLLocationCoordinate2D]`.
`Support/Polyline.swift` decodes precision-5 coordinates and rejects malformed
or out-of-range input.

The store retains encoded geometry. `StoredModelMapper` decodes it when loading
the in-memory UI snapshot, so map renders reuse coordinates. It prefers
`map_polyline` when `geometry_state == .detailed` and the string is nonempty,
and falls back to `map_summary_polyline` otherwise. A lazy per-route cache can
follow if profiling shows whole-snapshot decoding is too expensive.

## Open gaps

1. **No per-activity endpoints yet.** `GET`/`PATCH /api/v1/activities/{id}` and
   `POST /api/v1/activities/{id}/refresh` from the plan's endpoint table are not
   implemented. The first native client is therefore read-only, which matches
   the plan's own rollout ordering — native mutations come after read sync is
   stable — but it does mean the detail view cannot edit.
2. **Production universal links are still unresolved.** The custom scheme covers
   local development. Replacing it needs a final bundle identifier, an Apple
   team, an Associated Domains entitlement, and a hosted AASA file. None of
   those should be committed speculatively; in particular a signing team is
   unnecessary for Simulator development and a personal team is not a shared
   setting.

### Closed since this plan was written

- `/api/v1/activities` and `/api/v1/photos` were documented in
  `src/contracts/v1/openapi.ts` without route handlers. Both are now implemented
  (`src/app/api/v1/activities/route.ts`, `src/app/api/v1/photos/route.ts`), so
  the document no longer overstates the surface and a generated client will not
  expose methods that 404.
- The iOS target moved from Swift 5 to Swift 6 language mode, alongside the
  `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` and
  `SWIFT_APPROACHABLE_CONCURRENCY = YES` settings it already had.
- The placeholder bundle identifier was replaced with the stable
  `page.dominik.activitymap`, which a registered URL scheme and any future
  universal link both depend on.
- Deployment configuration, the `activitymap` URL scheme, and a localhost-scoped
  ATS exception are wired through xcconfig and `Info.plist`, and read by
  `Networking/APIConfiguration.swift`.

## Phases

Each phase is independently useful and leaves the app running.

**Phase A — Contract and configuration.** *Done.* Deployment configuration, the
URL scheme, the localhost ATS exception, the stable bundle identifier,
`APIConfiguration`, and Swift 6 language mode are in place, with
`MOBILE_AUTH_REDIRECT_ALLOWLIST=activitymap://auth/callback` set in the local
`.env`. The Zod-derived Swift DTOs and their CI drift check are in place too.

**Phase B — Authentication.** *Done.* `AuthController`, `SessionStore` and
`AccountSheet` use the shared API client and render the real `/api/v1/me` response.

**Phase C — Local store.** *Done.* Three `@Model` types, scoped `LocalStore`,
container wiring, DTO/UI mappers, and simulator Swift Testing coverage are in
place. Sample data is preview-only. `ActivityStore.load(from:scope:)` reads the
store; runtime loading will be connected to the sync coordinator in Phase D.

**Phase D — Sync engine.** Add `SyncAPI` and `SyncEngine` around the existing
`APIClient`, port the `v1-sync.ts` tests, and trigger a pass after login and on
foreground. Connect committed data to `ActivityStore`, including account-switch
and logout isolation.

**Phase E — Polish.** Sync status in `HeaderBar`, offline and error states that
distinguish "no network" from "session expired", scope clearing on logout and
account switch, and the retention/freshness metadata (`retentionDays`,
`cursorValidUntil`, `lastSummaryReconciledAt`) surfaced somewhere honest in the
account sheet.

## Test strategy

Use Swift Testing, per the project's guidelines. Mirror the existing TypeScript
sync tests rather than inventing new cases — `src/lib/sync/v1-sync.test.ts` is
370 lines of exactly the right scenarios.

Minimum coverage:

- Bootstrap drains both resources and ends with the activities' `snapshotCursor`.
- A mutation arriving during bootstrap is still applied, via the mandatory
  post-bootstrap catch-up.
- Replaying an already-applied changes page is a no-op.
- `409 sync_rebootstrap_required` clears the scope and rebootstraps exactly once.
- A crash between applying a page and committing leaves the old cursor intact.
- An activity delete removes its photos.
- An empty changes page advances the cursor without reporting changes.
- A non-advancing `nextCursor` terminates instead of looping.
- Polyline decoding round-trips against fixtures shared with the web client.
- Logout clears the Keychain, the scope's rows, and its `SyncState`.

The `LocalStore` facade should be injectable so the engine's tests run against
an in-memory `ModelContainer`, the same dependency-injection shape the
TypeScript services and `runV1Sync` already use.
