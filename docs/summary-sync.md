# Compact summaries during normal sync

Web and iOS download the server's current compact stream summaries during normal
activity sync. The activity bootstrap/change responses still contain only stream
metadata. A separate background stage reads
`GET /api/v1/stream-summaries/compact?ids=…` in sequential batches of at most 100.
This endpoint reads stored data and can derive summaries from stored raw streams;
it never fetches from Strava.

## Scope and local storage

- Web persists encoded compact DTOs in the `stream_summaries` IndexedDB store in
  `activitymap-sync-v1`. The database upgrade preserves existing activities,
  photos and sync checkpoints.
- iOS reuses `StoredStreamSummary` in SwiftData. No new native data model or
  bootstrap is required.
- Catch-up covers the whole local library with current stream metadata, including
  libraries synced before this feature and activities without GPS. It prioritizes
  recent activities and skips already-current local summaries.
- Activity browsing becomes ready before summary catch-up completes. Catch-up
  stores each successful batch so an interrupted pass can resume missing data.
- A detail reads its local compact summary first. The existing demand request is
  still available while catch-up is incomplete or the server has no stored summary.
  Only a mounted chart expands encoded samples into arrays.

Current features use compact summaries for elevation profiles and the linked map
cursor. Statistics use activity-level totals, and route rendering uses activity
polylines. Full-resolution raw streams remain server-side; native raw persistence
(#216) is deferred until a feature needs it. Offline basemap and photo-byte
availability are separate concerns.

## Authenticated web library ownership

`OfflineSyncProvider` registers the sole activity/photo network writer for the
signed-in account. Startup, Sync now, reconnect, edits, activity refresh and import
progress all request that writer through `requestLibrarySync`. Requests received
during a pass wait for a subsequent pass, so a response begun before an edit cannot
satisfy that edit's refresh. Profile catch-up stays an independently cancellable
follow-up and does not delay the visible library refresh.

`LibraryOwner` reads activities, photos and their checkpoint in one IndexedDB
transaction. Committed writes notify this owner; failed or aborted writes do not.
It publishes one structurally shared snapshot under `libraryQueryKeys.snapshot`
and exposes it to the activity/photo hooks through `useSyncExternalStore`.
Authenticated hooks neither fetch Server Action pages nor write their own caches.
Legacy guest and development-gallery observers remain separate.

The snapshot distinguishes an unhydrated cache, a partial bootstrap, and a
completed library (including a genuinely empty library). Partial cached rows are
usable offline, but selection pruning and the first-import prompt wait for
completeness. Browser origins isolate deployments; `auth:<user-id>` isolates
accounts within each origin. Account transitions abort and drain prior writes,
clear the departing snapshot and disk scope, and serialize cleanup before new
network work. Sign-out buttons await this cleanup before reloading. Cross-tab
commit notifications invalidate local reads without broadcasting activity or
photo payloads, even when the writing tab has no mounted owner. Provider/view
leases release listeners on unmount; remounts reconcile missed disk changes.

Run `pnpm exec playwright-core install chromium` once, then
`pnpm test:library-owner` for the composed browser proof. The runner creates and
removes its own temporary Next workspace without running migrations or loading
application credentials. It mounts the production provider, hooks and activity
list, intercepts only sync API responses, and uses real Chromium IndexedDB.
Evidence (traces, request logs, failure captures and server logs) is written to
`output/library-owner/`; `LIBRARY_OWNER_OUTPUT` overrides the destination. CI runs
the same command with lockfile-pinned Chromium. These checks exercise client-side
commit/rendering boundaries; database API behavior is covered separately by the
sync contract and database suites.

## Freshness and recovery

Stream generation/revision/state arrive through ordinary activity sync. A server
stream write publishes an activity upsert, so later normal sync discovers newly
available summaries. Missing/not-fetched streams do not trigger bulk Strava
requests. A missing response is not an empty chart; a valid compact summary with
no usable elevation data can still be cached for its other series.

Source invalidation removes stale presentation. Activity deletion, scope changes
and authoritative replacement remove or invalidate the corresponding local
summaries. In-flight responses must pass the current scope/activity fence before
being written or displayed. There is no age-based expiry for current summaries.

Cancellation stops catch-up without rolling back completed activity sync. Retry
deadlines are honored on later normal sync passes; summary failures do not turn
successfully synced activities into an empty or failed library. Persistent-cache
availability is best effort on web (browser quota/private-mode limitations), and
foreground detail loading keeps its existing fallback.

## Payload budget and verification

Run `node --import tsx scripts/benchmark-summary-sync.ts` to regenerate
[`summary-sync-payload-budget.json`](summary-sync-payload-budget.json). The script
validates 5,000 synthetic compact DTOs with the production schema:

| Scenario                        |           Encoded DTO total | Largest 100-entry batch |
| ------------------------------- | --------------------------: | ----------------------: |
| Mixed existing corpus           | 14,529,893 bytes (13.9 MiB) |           290,735 bytes |
| Largest corpus fixture repeated | 23,893,893 bytes (22.8 MiB) |           478,015 bytes |

A fully uncached 5,000-entry library takes 50 batch requests. Subsequent passes
skip current persisted summaries. These figures describe JSON payloads, excluding
database indexes, record wrappers, HTTP envelopes and compression. The largest
fixture is not a worst-case codec bound. Actual persistent disk allocation and
physical-device performance remain separate measurements.

Run `node scripts/verify-summary-sync.mjs /tmp/activitymap-summary-verification`
for the production-module browser checks (requires Chrome; `CHROME_PATH` can
override its location). The [recorded browser run](summary-sync-browser-verification.json)
covers migration, blocked-upgrade recovery, cold module reload with zero profile
requests, late-write rejection, cross-tab deletion and 5,000 persisted records.
Chrome on an Apple M4 Pro reported about 9.8 MiB of additional origin storage for
the mixed synthetic library, including minimal activity records and database
overhead. This is a browser estimate, not exact summary-file allocation or an
iPhone performance claim. The offline check assumes the application shell has
loaded; it does not add a service worker for offline application startup.

Native simulator validation covers `StreamSummarySyncTests`, `StreamSummaryCacheTests`,
`StreamSummaryLoaderTests`, `StreamSummaryReplacementTests` and `SyncControllerTests`:
42 tests passed, including the 5,000-activity catch-up, pause/account transitions,
offline detail loading and foreground/background response ordering. These are
simulator checks; physical iPhone/iPad storage, latency and memory measurements
remain under #229.
