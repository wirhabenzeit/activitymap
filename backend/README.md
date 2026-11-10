# ActivityMap Convex application

This package is the deployment source for the application backend. The geo lab
remains a separate Convex project. Install dependencies from both lockfiles
before checking the package.

```sh
pnpm install --frozen-lockfile
pnpm --dir backend install --frozen-lockfile
pnpm --dir backend check
```

The check regenerates Convex function types and checks the schema, validators
and function calls without a deployment credential. The same check runs in CI.
For deployment validation, run `pnpm exec convex dev --once --typecheck enable`
from this directory against a dedicated development deployment. Select that
project explicitly and check its name before uploading the bundle. The geo
lab contains a different schema and uses its own deployment configuration.

## Deployment boundary

`owners` is the durable owner assignment and permission fence. Owners keep
their application user and provider athlete IDs. A handoff records a new epoch
with a compare-and-set against the current epoch. Previously used epochs cannot
be issued again. Source and publication mutations check the same assignment and
account generation. Convex document IDs stay inside the application backend.

The authenticated app derives the bridge actor from the resolved session. The
read-only bridge accepts an HMAC over the complete request body, timestamp and
signer ID, valid for 30 seconds. Configure `ACTIVITYMAP_CONVEX_SITE`,
`ACTIVITYMAP_CONVEX_KEY_ID` and `ACTIVITYMAP_CONVEX_SIGNING_KEY` in the app's
server secret store. Configure `ACTIVITYMAP_BRIDGE_SIGNING_KEYS` on Convex as a
map from key IDs to 32-byte secrets encoded as 64 lowercase hex characters.
Both ends decode the hex before signing/verifying. Deploy signer and verifier
together; the earlier text-byte signatures are incompatible. For rotation,
install the new verification key, switch the signer, then retire the prior key
after in-flight requests expire. Use different keys for each environment.
Requests can be replayed within the time window; a single-use nonce is required
before adding any write operation.

## Serving preview owners from this package

Preview owners are listed in `ACTIVITYMAP_CONVEX_PREVIEW_OWNERS`, keyed by
application user ID. An entry selects its data source:

- `{ "epoch": "…", "transport": "app" }` reads this package through the signed
  bridge. The epoch must be the owner's current Convex assignment; any other
  epoch fails closed. Requires the three `ACTIVITYMAP_CONVEX_*` bridge settings.
- `{ "epoch": "…", "key": "…" }` reads the isolated lab deployment from #495
  and requires `ACTIVITYMAP_CONVEX_PREVIEW_SITE`.
- `{ "epoch": "…", "transport": "app", "live": true }` additionally moves the
  web client's library onto live Convex queries (`src/lib/sync/convex-live.ts`):
  it subscribes to `library.list` instead of running the REST sync, commits
  pages into the browser library store, and fetches `library.activity` for the
  detailed polyline (GPX export). Requires `ACTIVITYMAP_CONVEX_URL` (the
  deployment's `.convex.cloud` URL), an app issuer
  (`ACTIVITYMAP_AUTH_JWT_ISSUER`) and the matching Convex auth settings. If the
  token is rejected, a query fails or no page arrives within 20 seconds, the
  client falls back to the REST sync. Chart summaries and the status panel
  still use their REST routes.

Both use the same adapter (`src/server/preview/convex.ts`), so the v1 sync,
list, summary, stream, places and status routes behave identically. This
package serves activity metadata, photos, streams, recordings, summaries and
matches. Ingestion status reports stored data only, because provider
ingestion does not run here.

## Development deployment and import

The development project is `activitymap-backend-dev` (team
`dominik-schroder`). `convex dev --configure` writes its deployment to
`backend/.env.local`, which is not committed. Add the local bridge signer to
the same file and the matching verification key to the deployment:

```sh
pnpm exec convex env set ACTIVITYMAP_BRIDGE_SIGNING_KEYS '{"dev1":"<hex>"}'
# backend/.env.local
ACTIVITYMAP_CONVEX_SITE=https://<deployment>.convex.site
ACTIVITYMAP_CONVEX_KEY_ID=dev1
ACTIVITYMAP_CONVEX_SIGNING_KEY=<hex>
```

The importer and the shadow-write mirror write through a separate signed
route, `/internal/write/v1`. It has its own key map and signature domain, so
the read bridge's key can never authorize a write, and every request carries a
single-use nonce (`bridgeNonces`, expired hourly). Add a writer key next to the
reader key:

```sh
pnpm exec convex env set ACTIVITYMAP_BRIDGE_WRITER_KEYS '{"devw1":"<hex>"}'
# backend/.env.local
ACTIVITYMAP_CONVEX_WRITER_KEY_ID=devw1
ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY=<hex>
```

Copy an owner from the local development Postgres, keep it current, and
compare what the v1 handlers serve from both backends:

```sh
pnpm convex:import-owner --user <userId>
pnpm convex:mirror-owner --user <userId> [--watch <seconds>]
pnpm convex:verify-owner --user <userId>
```

Provisioning stays operator-only (`owners.provision` through the Convex CLI);
it is not exposed on the write bridge. All three scripts refuse to read
anything but the local database. The verifier runs the real bootstrap and
stream-summary handlers against Postgres and against this package, and exits
non-zero on any difference.

## Authenticated clients

Public functions (`convex/library.ts`) identify the caller from a short-lived
token issued by the app's Better Auth `jwt` plugin (`src/lib/auth-jwt.ts`):
ES256, `sub` = application user ID, `aud` = `convex`, 15 minutes, no profile
claims. `convex/viewer.ts` resolves the owner from the token subject and
serves only owners assigned to Convex. Public functions take no user argument.

`convex/auth.config.ts` reads two variables per deployment. Convex refuses to
deploy an auth config that reads an unset variable, so set the issuer before
deploying:

```sh
# No authenticated access (the default until an app environment is wired):
pnpm exec convex env set ACTIVITYMAP_AUTH_JWT_ISSUER disabled
# Wired to an app environment (must equal that app's ACTIVITYMAP_AUTH_JWT_ISSUER):
pnpm exec convex env set ACTIVITYMAP_AUTH_JWT_ISSUER https://activitymap.cc
pnpm exec convex env set ACTIVITYMAP_AUTH_JWKS 'data:text/plain;charset=utf-8;base64,<public JWKS>'
```

The JWKS is the app's `/api/auth/jwks` response; the plugin creates its key on
the first token request. To rotate, publish old and new public keys together,
rotate in the app, and drop the old key after 15 minutes. Change variables
only after the matching auth config is deployed: Convex validates each change
against the deployed config.

## Live library queries

`convex/library.ts` holds the public queries for authenticated clients
(`requireViewer`): `list` (paginated activity cards: the v1 DTO without the
detailed `map_polyline`, up to 256 per page), `activity` (the full DTO),
`summaries` (up to 32 chart summaries) and `status`. None reads `ownerHeads`,
so subscriptions re-run only when the rows they read change.

Convex limits the data one transaction reads to 16 MiB, counted on whole
documents, and an activity document can hold about 256 KiB. Functions that
read many activities stay within half of that (`convex/activityProjection.ts`):
`list` pages and the stats recount stop after 6 MiB of activities
(`maximumBytesRead`), so a page can hold fewer than requested and continues
from `continueCursor`; reads by ID take at most 32 activities with their
recordings. `tests/library.test.ts` checks this with near-maximum activities
and transaction limits enabled.

`status` reads `ownerStats`, a per-owner counts document that `applySource`
and recording publication update in the same transaction (skipping writes
that change no count), plus the oldest and newest activity from the
`by_owner_live_start` index. New owners start with zero counts. For owners that
existed before `ownerStats`, run a recount once; writes keep counts consistent
while it runs, and `status` reports `ready: false` until it finishes. The
photo counts (`photoCount`, `activitiesWithStoredPhotos`) are kept by the
photo writes in the same way; an owner whose photos were stored before these
counts existed needs one recount too:

```sh
pnpm exec convex run stats:rebuild '{"userId":"<userId>"}'
```

### Live owners in production

Preview owners exist only outside Vercel Production. To load an ordinary
production account's library through these queries, list it as a live owner in
the app:

```sh
ACTIVITYMAP_CONVEX_URL=https://<deployment>.convex.cloud
ACTIVITYMAP_CONVEX_LIVE_OWNERS='["<userId>"]'
```

Only the library download changes for such an account
(`src/server/convex-live-owners.ts`): edits, charts and status keep their
Postgres routes. Photos come from here as well: `library.changes` sets
`photos` when a read passed photo changes, and the client then reads the
whole list through `library.photos` (500 a page) and reconciles its store
(`src/lib/sync/live-photos.ts`). The account must also be a
shadow owner, so the mirror keeps this deployment current, and its counts need
one `stats:rebuild`. Library changes reach the browser after the next mirror
run. Remove the account from the list to return it to the REST sync.

### Read owners in production

A live owner's browser loads its library from here, but the app's v1 routes
still answer from Postgres, and so does the iOS app. A read owner moves those
reads as well, while Postgres stays the writer (step 2 of
`docs/convex-writer-cutover.md`):

```sh
ACTIVITYMAP_CONVEX_READ_OWNERS='{"<userId>":"<epoch>"}'
```

The value maps application user IDs to the owner's current Convex epoch
(`src/server/convex-read-owners.ts`); the read bridge settings
(`ACTIVITYMAP_CONVEX_SITE`, `ACTIVITYMAP_CONVEX_KEY_ID`,
`ACTIVITYMAP_CONVEX_SIGNING_KEY`) must be present. For such an account these
routes read through the signed bridge: sync bootstrap and changes, the
activity and photo lists, stream summaries and the activity places route.
Unlike a preview owner, the account keeps every write: edits, refreshes,
imports, sharing and deletion run on Postgres and reach Convex through the
mirror.

- **Cursors.** A sync cursor belongs to one backend and epoch. The first
  request after the switch, in either direction, answers that a new bootstrap
  is required, and the client downloads the library once.
- **Streams of one activity.** Convex answers when it holds a current
  recording. Otherwise, and for an explicit refresh or when the bridge fails,
  the request takes the Postgres path, which can still fetch from Strava.
- **Stream access.** Postgres decides who may read streams. Every stream or
  summary read from Convex is released only after Postgres confirms that the
  account is still eligible and owns the activity
  (`src/server/preview/authorized-streams.ts`), so a deauthorized account or
  a deleted activity gets nothing from the copy, whatever the mirror has
  done.
- **Ingestion status** stays on Postgres: it describes the jobs of the store
  that writes.
- **Failure.** The list and sync routes do not fall back, because a cursor
  cannot move between backends mid-download. If the bridge is unreachable or
  the epoch is no longer current they fail, and removing the account from the
  setting returns it to Postgres.

## Shadow writes

While Postgres remains the writer, `src/server/convex-mirror/mirror.ts` copies
an owner's changes into this package. Postgres records every visible
activity, stream and match change in `sync_change`, so the mirror needs no
hooks in ingestion code:

- A run reads the activities with changes after its checkpoint, re-reads their
  current Postgres state and writes it through the fenced batch functions in
  `convex/importer.ts`. Writes are labelled with a run revision that only ever
  increases, so out-of-order or repeated runs cannot regress Convex.
- The stream trigger inserts `sync_change` rows without the per-athlete lock,
  so a lower sequence can commit after a higher one was read. Each run also
  replays the last 15 minutes of changes. Re-applying identical state only
  advances the revision fence and publishes no change.
- Stream refreshes replace a recording only with a strictly newer revision;
  match results are published under the catalogue selected from the Postgres
  matching version, which the mirror switches before publishing.
- The checkpoint (`ownerHeads.mirror`) only moves forward, per chunk, so a run
  that stops early (time budget, catalogue change) continues next time. The
  importer is the same code in full mode.

Photos are provider metadata, one document per photo (`convex/photos.ts`).
The mirror sends the current photo set of every activity it copies. A photo
change on its own copies the set of that photo's activity, or deletes the
photo here when Postgres no longer has it. Photo changes appear in the change
feed as `photo` entries; deleting an activity removes its photos without
separate entries, as clients drop them with the activity. Each activity's
photo set carries a source revision (`photoSets`, also for an empty set), so a
stale writer can neither replace nor delete newer photos. Photo changes have
their own position in the checkpoint (`mirror.photoSequence`), separate from
the activity position. A library copied
before photos were mirrored is caught up by a resumable pass over all
activities, tracked in the checkpoint (`mirror.photos`, `null` when done).
Deploy this package before the app version that mirrors photos or reads them
live: an older deployment rejects the new write operations and has no
`library.photos`.

`POST /api/cron/mirror-convex-shadow` runs the mirror for the users listed in
`ACTIVITYMAP_CONVEX_SHADOW_OWNERS` (a JSON array of application user IDs). It is
off unless that list is set and `ACTIVITYMAP_EXTERNAL_EFFECTS=enabled`, and it
requires `CRON_SECRET` plus the writer settings above in the app's
environment. The Cloudflare cron worker calls it every ten minutes.

Shadow owners are also mirrored right after a write: once a Strava webhook
event has been processed and once an activity edit has been answered
(`src/server/convex-mirror/shadow-run.ts`). These runs have a 20-second
budget and can overlap the scheduled one; fenced writes make that safe, and
the scheduled run remains the safety net for everything else (hourly
ingestion, stream and match jobs, and any trigger that failed).

### Place catalogue copy

Matching here needs the places Postgres matches against (step 3 of
`docs/convex-writer-cutover.md`). The mirror job copies them in whatever
remains of each run's time budget (`src/server/convex-mirror/catalogue.ts`),
through the write bridge operations `catalogueState`, `beginCatalogue`,
`importPlaces` and `completeCatalogue` (`convex/places.ts`).

A rowset is the active serving snapshot at one catalogue revision: its rows
that are neither retired nor hidden, the same selection as
`loadBatchPlaceCatalogue`. Place IDs are the Postgres place IDs, so results
computed here name the same places as results copied from Postgres. Rows are
stored in `places` by quarter-degree tile; the catalogue manifest and coverage
are one stored file referenced from `placeCatalogues`.

The copy runs in ascending place-ID order, 500 rows a call, and continues from
the last imported ID after a deadline or an error. Both sides keep a digest
over the rows, and a rowset is marked complete only when its row count and
digest agree; nothing may read it before. A catalogue change in Postgres
starts a new rowset, and one that changes during its copy is abandoned.
Abandoned and superseded rowsets are not removed yet.

The mirror response reports progress under `catalogue`, and the log line is
`Convex catalogue copy`. The eight-country catalogue has about 176,000 such
rows, which takes on the order of ten scheduled runs. Deploy this package
before the app version that copies: an older deployment rejects the new
operations and the mirror job then answers 500.

### Shadow matching

With a complete catalogue rowset, matching can run here without any client
seeing the results (`convex/shadowMatching.ts`):

```sh
pnpm exec convex run shadowMatching:start '{"userId":"<userId>"}'
pnpm exec convex run shadowMatching:status '{"userId":"<userId>"}'
```

A run walks the owner's library in activity-key order. Each step is a Node
action (`convex/shadowMatchingWorker.ts`) that takes a small group of
recordings (at most 12 activities, 25,000 GPS samples and 4 MiB of raw
recording), reads their files, prepares the tracks with the application's own
code, reads candidate places by tile and runs the matcher the Postgres worker
uses. The worker refuses a rowset or recipe other than the one the owner's
copied results were computed with. Results go to `shadowMatches`; a result
whose recording changed meanwhile is dropped. A group that exceeds the tile,
page or result budget is retried as its first activity alone, and an activity
that still fails is listed on the run.

When the walk ends, the run compares every activity's shadow result with the
result the mirror copied from Postgres, ignoring `resultRevision`, and keeps
the counts (`same`, `different`, only one side, neither) and up to 20
differing examples (status and place count only) under `comparison`. A run
that stopped with an error continues with `shadowMatching:resume`.

### Production parity check

`pnpm convex:verify-owner` compares a whole library but reads only the local
database. In production, `POST /api/cron/convex-shadow-parity` checks the same
shadow owners once an hour (Cloudflare cron `5 * * * *`), with the same switch
as the shadow writes. For each owner it compares a bounded sample:

- a window of the owner's activity IDs that rotates every hour, 200 at a time,
  so a 4,600-activity library is covered in about a day, plus
- up to 200 activities changed in the last 24 hours, including deletions.

For the sample it builds what the v1 handlers serve from Postgres (bootstrap
items with place matches, and stream summaries) and reads the same through
the signed read bridge (`activityIds` and `summaries` in `convex/sync.ts`,
mapped by the preview adapter). The comparison is shared with the local
verifier (`src/server/convex-mirror/compare.ts`);
`placeMatches.resultRevision` is an expected difference.

Photos are compared as the whole photo set of each sampled activity (the
`activityPhotos` read), so a photo Convex should have deleted is found as
well as a missing or differing one. A set is skipped while one of its photos,
on either side, has a `sync_change` above the mirror's photo position
(`mirror.photoSequence`, or `mirror.sequence` before the first photo change)
or less than 15 minutes old. During the one-time photo catch-up only
activities up to `mirror.photos` are compared.

The mirror's checkpoint (`importer:mirrorState`, the write bridge's `state`
operation) decides what must already match. An activity is skipped as in
flight when its latest `sync_change` is above `mirror.sequence` or less than
15 minutes old (the mirror's replay window for late commits). The change log
is read after both backends, so a change that reached either side is visible
to the check. While a full copy is running (`mirror.full`), the report says
`copy: "in-progress"`, the checkpoint is `full.through`, and only activities
up to `full.after` are compared. Before the first copy nothing is compared.

The result is logged per owner (`Convex shadow parity`, or
`Convex shadow parity drift` at error level with counts and an example per
differing field; route, coordinate and description values, photo captions,
locations and image URLs are replaced by their length, also inside a parent
object that is shown). Drift or a failed check answers 500. The response carries the
counts and field names only.

Besides the writer settings, the check needs the read bridge's
`ACTIVITYMAP_CONVEX_KEY_ID` and `ACTIVITYMAP_CONVEX_SIGNING_KEY` in the app's
environment and the matching key in `ACTIVITYMAP_BRIDGE_SIGNING_KEYS` on the
Convex deployment. Postgres stream summaries are read through the same
repository as the v1 route, which may store a summary recomputed for a newer
summary algorithm, exactly as a client request would.

Coordinated provider cutover, Convex authentication and reactive web
subscriptions remain implementation-plan work.

## Recordings and publication

Activity rows hold bounded DTO metadata and versioned stream/matching
projections. Immutable gzip recordings and chart summaries use a separate
recording table and storage. Validators derive from the shared Zod contracts;
mutation boundaries also enforce their semantic refinements.

The coordinator supplies monotonically increasing `sourceRevision` values.
`streamSourceRevision` records the first revision of the current stream source,
using the same `STREAM_SOURCE_FIELDS` as Postgres. It stays stable across names
and kudos, but advances on geometry, privacy or sensor changes and deletion.
A recording fetched at revision N can publish when N lies between that stream
revision and the current metadata revision. Reverting source values or deleting
and recreating an activity does not revive an earlier worker. Accepted recordings
are associated with the current metadata revision for summary reads.

Matches are fenced by the current recording ID and catalogue, in addition to
owner assignment and generation. Metadata-only updates preserve recordings,
summaries and matches and allow in-flight work to finish. Stream-source changes
remove the recording and invalidate its derived results.

Preparation schedules reference-aware file cleanup before decoding and cleans
immediately on rejection/failure. Referenced files survive cleanup. Uploads
abandoned before preparation and full account erasure still require the
account/ingestion lifecycle work. Revocation hides data immediately.

## Sync and background maintenance

`ownerHeads` holds each owner's feed sequence, retention floor and rebuild
cursor. Feed writes serialize per owner so visible changes and sequence updates
commit together. Item/summary queries avoid this mutable head. Older or missing
projections return metadata without derived state; obsolete account generations
are excluded from reads.

A daily cron compacts changes older than 90 days in 256-row batches. Deletion
and each owner's removed-sequence floor commit together. Rows whose head has
already been erased are removed without blocking other owners. `retention`
returns the persisted floor without a cutoff argument. `changes` checks the
floor in the same transaction as reading the page. If compaction overtakes a
cursor after preflight, the bridge and changes handler propagate
`409 sync_rebootstrap_required`, asking the client to bootstrap again.

Catalogue selection hides old matches immediately and schedules bounded
invalidation batches. Superseded/revoked jobs stop; a fresh Convex routing epoch
resumes pending work. This publishes invalidations, not rematching jobs; the
matching worker must publish results against the new catalogue fence.

## Schema migration

The head-table/index changes and required `activities.streamSourceRevision`
target this undeployed foundation. Do not apply this schema over an existing
backend dataset without migrating owner heads, initializing stream revisions
conservatively to each row's current source revision, and rebuilding the changed
index. The lab schema and retained data are separate and untouched.
