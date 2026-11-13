# Existing-client Convex preview

The isolated Convex lab now serves the existing v1 library contract for explicitly
selected fixture owners and the attached retained library described below. Postgres remains the default. Better Auth, cookie
sessions, signed mobile bearer sessions and API rate limits still use Postgres.
There are no iOS source, project, package, generated DTO or deployment-config
changes.

## Data and cursor behavior

- Activity and photo list pages, activity/photo bootstrap, ordered deltas,
  individual and batch stream summaries (including compact), raw streams,
  matching results and ingestion status use one owner-selected data backend.
- The authenticated Next handler supplies the Better Auth user ID and linked
  athlete ID. The lab checks both against a registered owner and the configured
  epoch. Each preview owner has a separate read-only bridge key. The lab stores
  its SHA-256 digest, and the Next server holds the key. Only internal Convex
  mutations can provision, publish or erase preview data.
- An activity or photo publication, ingestion commit, matching commit or
  deletion records its client-feed change in the same Convex transaction.
  Activity deletion records the photo and activity tombstones. Scoped fixture
  updates reuse the durable worker and its source/version fences.
- The first activities bootstrap page captures the feed high-water mark.
  Changes that land during pagination are replayed from it. A preview cursor
  includes the owner and dataset epoch in a separate token format. Both backend
  switches, another owner's cursor and missing or expired feed history produce
  the existing `409 sync_rebootstrap_required` response. Older Postgres builds
  also reject the preview token prefix. Bootstrap/list continuations are scoped
  to the preview and resource.
- Stream manifests, file IDs and storage URLs stay inside the lab. Raw samples
  are read by the restricted bridge and go through the existing authenticated
  streams response. Current summaries and matches are tied to the current
  recording. Invalidated revisions cannot serve cached summaries as current.

## Verification

| Check                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosted Convex                         | Generated provider create, replace and delete, hosted matching, ordered changes during bootstrap, compact/raw stream reads, photo cascade, ingestion status, expiry, owner isolation and wrong/admin key rejection                                                                                                                                                                                           |
| Existing web client                   | Chromium ran the production sync client and real IndexedDB against handlers backed by hosted Convex. It exercised bootstrap, cached summaries, reopen with API requests disconnected, incremental deletes, rebootstrap in both directions and the scope-clear operation used on sign-out. The switching browser harness uses an empty Postgres-shaped replacement feed.                                      |
| Both real adapters and authentication | The exported Next route modules were invoked in process with local Docker Postgres and the hosted lab. Real Better Auth cookie and signed bearer sessions worked. The actual Postgres activity repository committed fixture upsert and delete changes. Both cursor directions returned 409. Logout revoked the session for both transports.                                                                  |
| Existing tests                        | 179 targeted Node tests passed, including the real SQLite cache proof with fixture repositories. Chromium also passed 14 shared sync vectors and five IndexedDB storage checks.                                                                                                                                                                                                                              |
| Native boundary                       | The iOS sync engine already stores opaque HTTP cursors, handles advancing empty pages and 409 rebootstrap, and stages a replacement before replacing SwiftData. The standalone Swift compact codec passed seven golden round trips, disk reopening and 16 malformed cases. The simulator device and runtime discovery commands timed out. There is no native simulator or physical-device end-to-end result. |

The hosted proof sets generated provider snapshots before delivering events.
This exercises the production-shaped durable fixture pipeline without a live
provider call. Writes in that original proof were synthetic and owner-scoped. The existing
4,602-recording benchmark scope is untouched and keeps its original expiry.
The proof reused its immutable catalogue. The temporary proof key was revoked and its local file removed.

## Reproduce

From the lab directory, confirm the target is the existing
`activitymap-geo-lab` dev deployment before deploying. Create the temporary
administrative key only for synthetic provisioning and cleanup.

```sh
pnpm exec convex dev --once --typecheck enable --tail-logs disable
umask 077
pnpm exec convex deployment token create activitymap-client-preview-proof \
  --deployment spotted-fennec-603 --save-env .env.client-preview-proof
```

Run from the repository root. The optional local Postgres check requires the
existing local Docker Postgres and Neon proxy. The script rejects non-local
Postgres. Chromium uses the installed Chrome by default, with `CHROME_PATH`
available for another executable. Omit either optional flag to run just the
remaining checks.

```sh
PREVIEW_BROWSER=1 PREVIEW_LOCAL_POSTGRES=1 NODE_ENV=development \
  node --conditions=react-server --import tsx \
  scripts/investigations/convex-geo/lab/verify-client-preview.mjs
```

The script temporarily adds two generated owner digests to the lab environment,
then restores the original setting and schedules scoped fixture cleanup. Run one
proof at a time to avoid overlapping changes to that setting. By default it
looks up the lab catalogue in the ignored full-library plan. Set
`PREVIEW_TEST_CATALOGUE` to an existing lab catalogue ID if the local plan is
unavailable. Keep generated IDs and secrets out of public logs.

From the lab directory after verification:

```sh
pnpm exec convex deployment token delete activitymap-client-preview-proof \
  --deployment spotted-fennec-603
rm .env.client-preview-proof
```

For a manually operated fixture preview, set
`ACTIVITYMAP_CLIENT_BACKEND=convex-preview` in the non-production Next
environment and set `ACTIVITYMAP_CONVEX_PREVIEW_OWNERS` to a JSON map of Better
Auth user ID to `{ "epoch": "...", "key": "..." }`. Use a fresh epoch and a
32-byte random key encoded as 64 lowercase hex characters. Register the same
user ID, athlete ID and epoch through `preview:register` in the lab, optionally
binding one generated ingestion account. The matching version is a 64-character
hex identity for that fixture's catalogue. Set
`ACTIVITYMAP_PREVIEW_BRIDGE_DIGESTS` in the lab to the JSON map of the same user
IDs to the SHA-256 hex digests of their key strings. Keep all values in server
configuration. Use `preview:publish` for fixture metadata/photos, and the
fixture provider snapshot plus receipt path for recording changes. A scope
without a linked fixture account supports metadata/photo fixture publication.

To roll back, remove the owner from Next routing and revoke its lab bridge
digest. Rotate the epoch for a new preview session. `preview:erase` disables
and clears the preview rows and feed. Revoking the separate fixture ingestion
account cleans up its recordings and matching data. Bounded manual
`preview:compact` calls prune history older than 90 days while preserving the
retention floor. This procedure targets the fixture scope only.

## Actual Next dev-server validation (2026-11-08)

The preview now also passes a real Next.js HTTP/browser test, using hosted
Convex fixture data and local Docker Postgres for Better Auth. The test starts
Next on `127.0.0.1:3100`, creates a short-lived signed session, then removes
the local fixture user and stops the server. The outer proof restores the lab
bridge configuration and erases only its generated fixture scope.

Sixteen HTTP assertions passed: unauthenticated rejection, cookie bootstrap,
bearer activity/photo lists, incremental sync, compact summaries, raw streams,
both per-activity summary formats, published place matches, ingestion status,
missing-recording rejection, disabled provider refresh, logout, and rejection
of both cookie and bearer sessions after logout. Chromium loaded both fixture
activities in the real `/list` UI and rendered `/map` with map tiles. The actual
browser bootstrap, delta and compact-summary requests returned 200; no browser
runtime or console errors were recorded. This does not prove full-library UI
performance or interactive place filtering. Request timings include dev
compilation and are not production latency measurements.

The test exposed and fixed an app-shell integration gap: rendering previously
called `getAccountInternal` for every authenticated user and failed when a
fixture owner had no Strava account. Explicit preview owners now skip provider
credential lookup/refresh while rendering. Their current-user DTO continues to
report no live Strava connection.

The successful browser run used Next's `--webpack` dev mode. Default Turbopack
served the HTTP endpoints, but the browser entered a repeated reload loop;
its cause remains uninvestigated. The test supports choosing either bundler.

After creating the temporary proof deploy key as described above, run from the
repository root:

```sh
PREVIEW_DEV_SERVER=1 PREVIEW_DEV_BUNDLER=webpack NODE_ENV=development \
  node --conditions=react-server --import tsx \
  scripts/investigations/convex-geo/lab/verify-client-preview.mjs
```

Revoke the proof key afterwards using the command above. Ignored evidence lives
in `lab/results/dev-server-preview/`: `report.json`, `server.log`, `list.png`
and `map.png`. TypeScript checking and linting of the changed files passed.
The retained full-library recordings were not changed or exposed by this test.

Add `PREVIEW_DEV_INTERACTIVE=1` to open a signed-in Chrome window and keep the
server and synthetic fixtures available for manual browsing. Its local session
expires after eight hours. Closing that Chrome window or stopping the process
resumes fixture cleanup; revoke the temporary deploy key after the process exits.

## Retained real-library preview (2026-11-08)

The real retained library is now attached, separately from the two-activity
fixture proof. `previewLibrary` imports metadata and links each activity to its
existing recording target. It checks the source owner, run, generation, activity
identity and live retention window. Reads validate the recording and published
match fences. No GPS files were uploaded again and matching was not rerun.

- 4,602 real activity DTOs imported from local Postgres in a read-only snapshot.
  Each source fingerprint matched its frozen recording. Metadata totals
  19,179,689 bytes; the largest activity is 26,977 bytes.
- The hosted read audit verified all 4,602 IDs, current recordings and saved
  matching results. 1,731 activities have nonempty matched-place lists.
- The real Next server and signed-in Chrome browser downloaded exactly those
  4,602 IDs into the production IndexedDB cache, with 4,602 stream metadata and
  matching bundles and a completed bootstrap. Routes rendered on the map;
  real activity names and an elevation profile were visible in the list.
- The pre-optimization first browser load was **72.123 seconds**, including development
  compilation and cache population. The captured browser traffic includes 48
  bootstrap requests, 47 compact-summary requests and five delta requests.
  At that point the client default was 100 records; the experimental bridge further
  split those pages into sequential batches of 32. This was a correctness proof,
  not acceptable final bootstrap performance or a production comparison.
- A web-only `storedLibraryPreview` capability enables reading saved place
  results and elevation data without pretending a live Strava account is
  connected. Refresh/edit permissions remain disabled. No iOS changes.
- The import credential was revoked and its local file removed. The running
  dev server holds only its owner-scoped read key. The local authentication
  session expires after eight hours; closing the preview deletes that session.
  Imported metadata has scheduled cleanup at the retained run's existing expiry,
  **2026-11-14 22:18:09 UTC**. Source recordings and retention were not changed.

Ignored evidence is in `lab/results/real-library-preview/`: attachment and
browser reports, private metadata, local preview configuration and screenshots.
Eight focused read-permission, mutation-permission and authentication tests
passed, along with app/lab type checking and changed-file lint.

To reopen the already attached library from the repository root (local Docker
database and proxy must be running):

```sh
node scripts/investigations/convex-geo/lab/open-library-preview.mjs
```

This opens authenticated Chrome and keeps Next running on `127.0.0.1:3100`.
It needs no Convex administrator credential. `prepare-library-preview.mjs` and
`attach-library-preview.mjs` perform the bounded metadata export/import when
needed; attachment requires a temporary lab deploy key in
`.env.real-library-preview`, which must be revoked after import.

## Bootstrap optimization (2026-11-08)

The four remote reads were an adapter implementation choice: its 32-record
bridge cap split a 100-record web page into four calls. Bootstrap also fetched
its head separately. The hosted bootstrap operation now returns the page,
matching bundles, freshness and change-feed head in one authenticated query.
Shared owner/run/catalogue bindings are resolved once per query. Recording,
source ownership, retention and published-match fences remain checked.

The Convex preview defaults to up to 500 activities per web page, with a 2 MiB
item payload budget and explicit continuation for short pages. Small groups of
32 database rows are still projected internally within that single query;
they do not create remote round trips. A trial using groups of 128 did not
improve elapsed time and was reverted. Legacy summary reads now allow 128 IDs,
so a 100-ID summary request also fits in one bridge read. The Postgres default
and shared client wire contract remain unchanged; no iOS changes are required.

Controlled fresh-browser runs used the same 4,602 retained activities, actual
web sync code and production IndexedDB cache on local Next Webpack development:

| Configuration                      | Full bootstrap | Browser bootstrap requests |
| ---------------------------------- | -------------: | -------------------------: |
| Original adapter, 100 per web page |       67.473 s |                         48 |
| Combined query, 250 per page       |       28.086 s |                         20 |
| Combined query, up to 500 per page |       26.279 s |                         13 |
| Final repeat, up to 500 per page   |       26.780 s |                         13 |

The final repeat is approximately 60% faster than the controlled baseline.
A warm reload displayed the cached list in 1.756 s and completed its delta
request in 2.273 s, without another bootstrap. The visible Chrome preview was
reopened with that verified cache. All 4,602 IDs, stream metadata and matching
bundles were checked. Optional compact-summary downloads run after bootstrap;
the earlier screenshot run's 47 summary requests should not be counted as
blocking the initial library download. Compression was already enabled.

One repeat encountered a Next development-server JSON parsing error before
the route handler; the subsequent full repeat passed. Its underlying dev-server
cause was not established. These timings include development overhead and are
not production latency or a controlled PostGIS comparison.

Validation: 43 focused bootstrap/delta/client/adapter tests passed, app and lab
TypeScript checks and changed-file lint passed, and the hosted client proof
passed concurrent-change, cursor, ownership, stream, matching and tombstone
checks. The proof deploy key was revoked and removed afterwards.

Ignored evidence: `lab/results/real-library-preview/browser-before.json`,
`browser-after-250.json`, `browser-after-500.json` and
`browser-optimized-confirm.json`. To repeat the cold/warm checks and leave an
authenticated preview open with the verified cache:

```sh
PREVIEW_BENCHMARK=optimized-confirm PREVIEW_REOPEN=1 \
  node scripts/investigations/convex-geo/lab/open-library-preview.mjs
```

## Production-build comparison and incremental validation (2026-11-08)

The actual `/list` UI was measured against both adapters using the same optimized
Next Webpack build. The build was made in a disposable source copy so the existing
development preview stayed running. A disposable copy of local Postgres supplied
the same 4,602 activities, recordings and saved matches. Provider credentials in
that copy were replaced with inert values. Neither the original Postgres library
nor the retained Convex recordings were modified.

Each case used three fresh Chromium contexts, identical viewport and browser
instrumentation, and the existing signed bearer authentication path restricted
to the loopback server. Service workers were disabled. Postgres's 500-item case
adds the already-supported `limit=500` query parameter; its production default
was not changed. All 4,602 exact IDs, current stream metadata, matching bundles
and completed sync state were verified after every run. No browser runtime or
failed API responses occurred.

| Backend / pagination                   | Full initial sync, median (range) | Bootstrap requests | Cached list visible, median |
| -------------------------------------- | --------------------------------: | -----------------: | --------------------------: |
| Hosted Convex, optimized pages         |          16.868 s (16.570–17.282) |                 13 |                     0.395 s |
| Local Postgres, current 100-item pages |          11.471 s (11.450–11.588) |                 55 |                     0.527 s |
| Local Postgres, 500-item pages         |             5.163 s (4.888–5.291) |                 12 |                     0.411 s |

Postgres additionally downloads 706 photo DTOs; the retained Convex snapshot has
none. To separate that extra work, the activity-only phase runs from the first
activity request to the final activity response: 12 requests for Convex, 47 for
current Postgres, and 10 for Postgres with 500-item pages. Representative second
runs took 15.416 s, 9.399 s and 3.908 s respectively for this phase. The full-sync
figures additionally include app startup, photos, delta catch-up and cache writes.

This is a production-build **local-client/hosted-Convex versus local-Postgres**
comparison, not a deployment-region-controlled database ranking. Network distance
favors Postgres. Browser routing used for loopback bearer authentication also
disables normal HTTP cache behavior equally across cases; cached-list results
measure persisted IndexedDB availability, not a CDN or service-worker test.

### Where the remaining time goes

In Convex's second run, backend adapter reads took 14.841 s of the 16.570 s full
sync. Hosted execution logs account for 7.972 s of query execution across the
12 activity pages: 18,876 documents and 30,073,988 database-read bytes. The other
roughly 6.9 s includes HTTP-action/transport overhead, transfer, and adapter
parsing/validation; it must not all be called network latency. Hosted query time
was consistent across three runs (7.978, 7.972, 8.019 s). The current projection
reads roughly four documents per activity, plus bounded over-read at byte caps.

Browser activity-cache write transactions totaled 0.139 s in that representative
run, and sync-response body reading/parsing 0.059 s. These instrumented spans can
overlap other work and are not an additive CPU profile. Convex's present bottleneck
is backend retrieval, not IndexedDB. In the Postgres 500-item run, activity reads
took 0.118 s and the matching-result repository 3.222 s, including its fences and
local database round trips. With 100-item pages, repeated browser processing also
becomes material: about 1.226 s of write transactions and 6.697 s of long tasks in
the representative run. Long tasks include UI work and overlap other measurements.

The browser receives roughly 23.1 MB of activity JSON, including stream/matching
metadata. A direct HTTP check with `Accept-Encoding: gzip` found that the local
production Next server returned **uncompressed** JSON for both backends. A
500-activity Convex response was 1,799,294 bytes; compressing the same response
locally would produce 639,374 bytes. The earlier compression observation concerned
the hosted Convex-to-adapter leg, not this browser-facing leg. Browser transfer is
negligible on loopback; actual deployment/CDN compression and a realistic network
test are still needed before predicting remote-device first-load times.

### Incremental production-UI proof

A separate disposable Convex owner was seeded with the same 4,602 metadata DTOs
and bootstrapped through the real production UI. Background activities in this
fixture do not clone the retained recordings; generated new/replacement recordings
use the normal durable fixture ingestion and matching path, with 4,800 samples.
This tests incremental correctness and full-cache behavior, not live Strava or
provider-network performance. The new fixture activity had a separate ID.

| Change                                            | Time from browser sync trigger to committed cache |         Sync requests |
| ------------------------------------------------- | ------------------------------------------------: | --------------------: |
| One new activity, recording and published matches |                                           1.382 s |      2 delta requests |
| Replacement recording and updated matches         |                                           1.517 s |      2 delta requests |
| Duplicate ingestion receipt                       |                                           0.513 s | 1 empty delta request |
| Same-input rematch                                |                                           0.689 s | 1 empty delta request |
| Reconnect after an offline recording update       |                                           0.843 s |            Delta only |
| Activity deletion                                 |                                           1.349 s |      2 delta requests |

The new recording/matches became available in 3.194 s after the fixture receipt;
replacement publication took approximately 2.162 s. These are separate from the
subsequent browser sync times and include polling granularity. Repeating the same
matching inputs took 1.332 s and correctly retained the existing result revision
and cursor. This does not validate a changed-catalogue migration.

Recording revision, published matching revision and the cached chart summary
advanced together. While disconnected, the old cache and cursor remained
readable and unchanged. Reconnection caught up without bootstrap. Deletion
removed the activity and its chart summary. A hash of every other cached activity
was identical before and after all changes. Reloading preserved the completed
library without a fresh bootstrap. The generated owner was erased, its fixture
ingestion account revoked and bridge access removed. The temporary deploy key
was revoked. The original retained run and its expiry remain unchanged.

### Assessment and follow-up

The existing client contract works for this pilot and ordinary updates avoid
full-library downloads. The remaining first-load cost argues for a maintained
client-facing activity projection in Convex, updated atomically with recording,
matching and deletion changes, to reduce per-activity reads while preserving the
current fences. Before implementing that larger change, test the actual hosting
regions and browser-facing compression. Larger Postgres pages are independently
promising and should be evaluated as a separate bounded change.

The full-cache browser proof, production build with TypeScript checking, lab
TypeScript checking and new JavaScript harness lint passed. No application runtime
code was changed in this validation; timing wrappers exist only in the disposable
build. The new internal lab helper `previewBenchmark:seed` accepts bounded metadata
batches only for generated fixture owners and rejects retained-library scopes.

Reproduction from the repository root, with local Docker services running:

```sh
node scripts/investigations/convex-geo/lab/prepare-production-benchmark.mjs
node scripts/investigations/convex-geo/lab/benchmark-production-web.mjs
```

The incremental proof additionally needs a temporary lab deploy key named
`activitymap-production-sync-proof` saved in `.env.production-sync-proof`, created
and revoked using the same deployment-token workflow above. Then run
`node scripts/investigations/convex-geo/lab/verify-production-incremental.mjs`.
Run only one fixture proof at a time because it temporarily extends the bridge
digest map. After revoking its temporary deploy key, run
`node scripts/investigations/convex-geo/lab/cleanup-production-benchmark.mjs` to
remove only the generated database/build and revoked-key file.
Private evidence lives in `lab/results/production-web/`: three browser
reports per case, `summary.json`, `breakdown.json`, hosted query logs and aggregates,
compression samples, `incremental.json`, and build/server logs. The disposable
database and build were removed after collecting evidence; the original preview
remains on port 3100.

## Maintained activity projection and wire compression

The application Convex package is separate from the lab. Its schema and server
bridge define typed writes, durable owner/backend assignments, routing epochs,
a rotatable request signer and transactional source, recording, catalogue and
revocation fences. It is ready for isolated integration work. Live app routes
continue to exercise Postgres or the fixture adapter until provider and owner
handoff work can switch reads and writers together.

The retained lab library now stores stream metadata and matching bundles on the
same indexed row as its activity DTO. Bootstrap and delta activity lookups use
that projection. Publication and changes share a transaction. Existing owners
can rebuild in bounded key order while their prior read path remains in service,
then activate the new schema in one transaction. The retained recordings and
their existing expiry were preserved. An audit compared all 4,602 exact IDs and
hashed all returned activity DTOs before and after. The hashes were identical,
including stream and matching revisions.

| Measure                                            | Before projection | With projection |
| -------------------------------------------------- | ----------------: | --------------: |
| Hosted activity pages                              |                12 |              12 |
| Convex document reads across activity pages        |            18,876 |           4,764 |
| Convex database bytes read across activity pages   |        30,073,988 |      24,646,077 |
| Hosted execution across activity pages, same audit |          10.247 s |         2.637 s |
| Direct activity-page audit elapsed                 |          17.903 s |         9.266 s |
| Production Chromium full initial sync, median      |          16.868 s |        14.901 s |
| Production Chromium full initial sync, range       |   16.570–17.282 s | 11.669–15.078 s |

The first browser run independently recorded 4,764 document reads and 2.594 s
of hosted execution across its 12 activity pages. The full browser run includes
the separate photo page, delta catch-up, app startup and storage. Cached list
visibility took a median 477 ms. The document-read target passed. The
below-10-second full-load target remains open in this hosting topology. A
final production build repeat verified the same library in 13.981 s.

The 144 backfill transactions added 4,749,099 logical serialized bytes of
projection data, averaging 1,032 bytes per activity. Convex reported 4,746
document writes and 24,811,289 database-write bytes for the rebuild, including
full activity rows and 144 owner checkpoint writes. These figures describe
backfill usage. Steady-state provider ingestion costs still require the pilot.
Activity updates now include a projection rebuild on the existing indexed row
in addition to their ordered feed entry. In the incremental fixture, the
replacement recording commit wrote 8 documents and 5,252 database bytes. Its
matching commit wrote 7 documents and 6,024 bytes. These totals include the
job and matching writes, so they do not isolate a per-update cost increase.

Production Next bootstrap and change responses negotiate gzip. The actual
authenticated loopback response for the first 500 activities transferred a
639,379-byte gzip body versus 1,799,294 bytes with identity, a reduction of 64%.
Both preserved the private/no-store policy and varied on encoding and
authentication. Chromium decoded the JSON normally. A hosted app/CDN path has
yet to be measured.

The full-cache incremental proof passed again. New activity sync took 2.151 s,
replacement 1.507 s, offline catch-up 0.836 s and deletion 1.440 s. Duplicate
receipts and same-input rematches advanced neither the cursor nor the activity
data. The hosted client proof also passed concurrent bootstrap/update, cursor
isolation, bridge authorization, summaries and tombstones. The application schema and signed bridge also passed tests with the Convex
test harness, including a genuine changed catalogue and a rejected stale
recording publication. The standalone local Convex binary download returned
404, so the separate application package still needs deployment validation.
Temporary proof keys were revoked. Ignored evidence is under `lab/results/production-web/` in the
`projection-*` reports.

## Pilot gates

The preview serves generated activity/photo fixtures and the explicitly attached
4,602-activity retained snapshot. Photos were not imported for the retained
snapshot. The fixture adapter accepts activity and upload IDs within
the current Postgres number-backed repository's exact range, at most 100 photos
per activity and bounded metadata documents. Broader DTO
limits need a separate check. Ingestion status summarizes the selected scope and
its scheduled jobs. It does not represent a live Strava history scan or
production backfill.

Client data editing, refresh/import, sharing, CSV export and account erasure
are disabled for opted-in preview owners until their data paths are implemented.
Sign-out remains available. The pilot still needs live provider and credential
ownership decisions, a coordinated erasure path, further bootstrap tuning and
controlled client load comparisons, a native runtime test and the separate authentication migration
gate. No live provider access or production database writes were used.
