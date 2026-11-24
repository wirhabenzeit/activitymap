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

## Status

This backend is the application's only store. An account's library, its
ingestion from the provider, and the app's own records (sign-in, provider
tokens, rate limits, the provider request budget) all live here; the app
reaches them through the signed bridges described below. A place catalogue
is built from OpenStreetMap extracts on disk and published here (see "Place
catalogue").

Web and iOS clients use authenticated live queries for library sync; the HTTP
API reads and writes the same Convex library through signed bridges. Live sync
uses each account's stored writer assignment and epoch, without per-owner
migration allowlists. First-use web/native discovery initializes an eligible
account's library before returning its live-sync URL. An account in handoff is
never switched to Convex by discovery or a library read. See "Client and API
reads" below.

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

## Development configuration

The development project is `activitymap-backend-dev` (team
`dominik-schroder`). `convex dev --configure` writes its deployment to
`backend/.env.local`, which is not committed and is read only by the Convex
CLI. The Next.js app reads the repository root's `.env.development.local`
(see [Local development](../docs/local-development.md)), so put the local
bridge signer there and the matching verification key on the deployment:

```sh
pnpm exec convex env set ACTIVITYMAP_BRIDGE_SIGNING_KEYS '{"dev1":"<hex>"}'
# .env.development.local (repository root)
ACTIVITYMAP_CONVEX_SITE=https://<deployment>.convex.site
ACTIVITYMAP_CONVEX_KEY_ID=dev1
ACTIVITYMAP_CONVEX_SIGNING_KEY=<hex>
```

The app writes through a separate signed route, `/internal/write/v1`. It has its own key map and signature domain, so
the read bridge's key can never authorize a write, and every request carries a
single-use nonce (`bridgeNonces`, expired hourly). Add a writer key next to the
reader key:

```sh
pnpm exec convex env set ACTIVITYMAP_BRIDGE_WRITER_KEYS '{"devw1":"<hex>"}'
# .env.development.local (repository root)
ACTIVITYMAP_CONVEX_WRITER_KEY_ID=devw1
ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY=<hex>
```

The place catalogue publisher reads the live catalogue through a third
route, `/internal/places/v1`, signed with the read bridge's key under its own
domain (`activitymap-places-v1`), so a signed library read can never be
replayed there or the reverse. Its operations (`liveState`, `liveHashes`,
`demandTiles`) only read and carry no nonce, so a dry run needs no writer
key.

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

### Client and API reads

Configure `ACTIVITYMAP_CONVEX_URL=https://<deployment>.convex.cloud` and the JWT
issuer/JWKS settings above. An account with a stored `writer: convex` assignment
and routing epoch can use live library queries. Authorization always comes from
the JWT subject; a deployment URL does not grant access to another account.
Vercel Preview uses its own sign-in records and Convex deployment through the
same application paths (see `../docs/preview-strava-login.md`).

The browser subscribes to activity cards and fetches detailed routes on demand.
Photo changes wake its paginated photo reader and reconcile the local store.
iOS uses the native SDK to supply full activity/photo pages to SwiftData; see
`../docs/ios-native-convex-sync.md` for retries, account isolation and lifecycle.

All v1 HTTP routes use `src/server/library/convex.ts` and the account's stored
epoch. They support older clients and native/web compatibility fallback. Edits,
refreshes, summaries, imports, sharing and deletion also use Convex. No mirror or
alternate database participates in these reads or writes. HTTP cursor identities
continue to bind the bridge deployment, owner, athlete and epoch; changing the
stored assignment fences the previous position.

## Provider gateway

A Convex worker that needs provider data asks the app for it
through the provider gateway: the app keeps the Strava
tokens and the request budget that all accounts share, and this package never
holds a provider credential.

`POST /api/internal/provider/v1` takes one owner and one read, signed with
HMAC-SHA256 over `activitymap-provider-v1`, the key ID, a millisecond
timestamp and the exact body, valid for 30 seconds
(`src/server/provider-gateway/contract.ts`). The reads are one activity, its
streams, its photos, or a page of the owner's activity summaries. The app
resolves the owner's account, refreshes an expired token and stores the new
one, reserves from the shared budget for every request (the refresh
included), and answers with the provider payload.

A read that fails in a way the caller can act on is answered 200 with a typed
failure: `rate_limited` (with the seconds to wait), `credentials_rejected`
(the owner must reconnect), `not_found`, `forbidden` (the grant does not cover
the activity) or `upstream_error` (with whether a retry can help). A bad
signature is 401, an owner the gateway may not read for is 403, and anything
unexpected is a 500 without detail. Two requests that refresh the same token
at once are not a failure: the one that loses reads the account again and
uses the credentials the other stored. A token the provider rejects before
its recorded expiry is refreshed once and the read repeated; only a refused
refresh or a second rejection is `credentials_rejected`. Activity IDs stay decimal strings from
the request to the provider URL, and a provider `Retry-After` (seconds or an
HTTP date) becomes the `rate_limited` wait.

The gateway is off until the setting is present in the app and automated
external effects are enabled:

```sh
ACTIVITYMAP_PROVIDER_GATEWAY_KEYS='{"<keyId>":"<64 hex characters>"}'
```

Which accounts it reads for is not a setting: it serves exactly the accounts
whose library has an active Convex writer assignment (`users.writer`). The
stored assignment and epoch are checked on every request. The caller is the Convex
ingestion worker ([Convex ingestion](#convex-ingestion)), through
`src/server/provider-gateway/client.ts`.

Requests carry no nonce, so a captured request can be replayed while its
signature is accepted. The timestamp may differ from the app's clock by 30
seconds in either direction, so a request stamped ahead can stay acceptable
for close to 60 seconds after it was first accepted. A replay cannot change
anything at the provider, since every operation is a read, but it is not
free of effects: it spends shared request budget, and it can refresh the
owner's token and store the new one.

## Writer field

Who writes an owner's library is recorded on the owner: `owners.writer`
(`postgres`, `handoff` or `convex`; absent means `postgres`) and
`owners.writerEpoch`, changed only by `owners.setWriter` with a
compare-and-set on the epoch. It is separate from `owners.backend` and the
routing `epoch`, which say who serves reads. Every library is written by
Convex. The other two values remain from the move off Postgres, when a
library was copied here and then handed over.

Every write to an owner's library calls `requireWritableOwner` in its own
transaction, naming who is writing; Convex ingestion writes as `convex`.
Scheduled continuations are fenced the same way: a catalogue walk
(`catalogue.next`) works for the writer it was queued under and checks it in
every transaction.

## Webhook events

The app records each Strava activity event here before answering Strava
(`src/server/strava/convex-webhook.ts`): the write bridge operation
`recordEvents` stores it in `providerEvents` (`convex/providerEvents.ts`),
once per delivery, and asks Convex ingestion for its activity in the same
transaction. An event that cannot be recorded is answered with an error, so
Strava delivers it again; the reconciliation sweep finds what is still
missed.

## New accounts

An account gets its library on its first request for activities
(`startLibrary` in `src/server/library/index.ts`): the write bridge's
`provision` creates the owner under the newest catalogue, `setWriter` hands
it to Convex, and the routing epoch is stored on the user. The first fetch
then starts the reconciliation sweep, which fills the library from the
provider's list, and answers when the sweep has read two pages or finished,
after at most fifteen seconds; the rest arrives through sync.

## Sign-in store

The app's auth library (Better Auth) keeps its records here: users, linked
provider accounts with their tokens, sessions,
verification values and signing keys. `convex/authStore.ts` holds one
document per record in `authRecords` and implements what the library asks
of a database: create, find, count, update and delete by a list of
conditions on a record's fields. The fields the library looks records up by
(`id`, `userId`, `token`, `identifier`, `accountId`, `email`) are indexed;
other conditions are checked in memory over the model's records.

The app reaches it through `POST /internal/auth/v1`, signed with the write
bridge's key under a domain of its own (`activitymap-auth-v1`), so a library
write cannot be replayed on this route or the reverse. Reads carry no nonce;
every change does. `src/server/auth/convex-adapter.ts` is the library's
adapter over that route. Dates are stored as ISO strings.

The app keeps all of its own records here:

- **Sign-in**: the auth library uses the adapter above.
  `src/server/auth/convex-records.ts` is what the rest of the app reads and
  changes: the user (athlete, writer, epoch), the provider account and its
  tokens (replaced only if they are still the ones that were read), and the
  marks for withdrawn access.
- **Mobile sign-in codes**: records of the model `mobileLoginCode`, redeemed
  by an update that returns the record as it was, so a code works once.
- **Rate limits and the provider budget**: `convex/appState.ts`, tables
  `rateLimits` and `providerBudget`. Both are counted inside one mutation,
  so two requests cannot take the same slot. Expired rate limit windows are
  removed daily.
- **Provider webhooks** (`src/server/strava/convex-webhook.ts`): there is no
  inbox. An activity event is recorded here before the provider is answered;
  if that fails the provider is answered with an error and delivers again,
  and the reconciliation sweep finds what is still missed. Withdrawn access
  removes the tokens and sets the date of erasure, 30 days later.
- **Erasure**: the scheduled run and "delete my account" erase the library
  here first, then the sign-in records, so a failure leaves the records that
  find the library again.
- **New accounts**: the first sign-in provisions the owner here directly and
  starts the first sweep.

## Erasing an account

An account is erased when its owner deletes it, or when provider access was
withdrawn and the retention period is over
(`src/server/strava/convex-webhook.ts`). The library goes first, through the
write bridge operation `eraseOwner` (`convex/erasure.ts`,
`src/server/library/erase.ts`), then the sign-in records, so a failure
leaves the records that find the library again.

`erasure.start` revokes the owner, which fences everything at once: no read,
write, job or sweep works for a revoked owner. `erasure.step` then deletes
the owner's activities, stored recordings, photos, changes, jobs, sweep and
event receipts in bounded batches, and the records about the owner last.
Afterwards the user ID is unknown here and can be provisioned again from
nothing. A user Convex never knew is answered `false`.

## Convex ingestion

For an owner Convex writes for, activities come in through jobs in this
package (`convex/ingestion.ts`).
There is one job per owner and activity. A provider event counts a request
on the job and schedules a run for the job's due time; nothing polls.

A run is the Node action `convex/ingestionWorker.ts`. It reads through the
provider gateway and never holds a provider credential:

1. **Claim.** The run takes a five-minute lease and a new source revision:
   the larger of the current time in milliseconds and one more than every
   revision already used for the activity.
2. **Source.** It reads the activity, and its photos when the activity has
   any, converts them with the app's provider mapping
   (`backend/ingestion/provider.ts`), and writes the activity and its photo
   set in one transaction. When the provider answers that the activity does
   not exist, it writes the deletion. The event's own aspect is not trusted.
3. **Recording.** Only when the activity has no current recording (a new
   activity, or a change to the fields samples depend on): it reads the
   streams, stores the file and publishes it through the fenced recording
   path (`convex/recordingWorker.ts`). An activity without samples (one typed in by hand,
   which is not asked for streams, or one whose streams the provider does
   not have) gets an empty recording: that is how "nothing to fetch" is
   remembered, and why such an activity does not stay pending.
4. **Match.** When the activity has a current recording without a current
   match for the owner's catalogue, the worker matches it against the place
   catalogue (`backend/matching/activity-match.ts`) and publishes the
   result. A title edit keeps recording and match; a new recording is
   matched again. A match read from the live catalogue at a revision that a
   later publication replaced is not current either. Which catalogue is read
   depends on the owner's matching version (see "Place catalogue"); when
   it names none that is available, the activity is finished without a
   match.
5. **Complete.** If the activity was requested again while the run was
   under way, the job starts over at once.

What keeps this safe:

- **One writer.** A job is claimed only while Convex is the owner's writer,
  and each library write checks the writer in its own transaction. A run
  that started before a handoff is refused when it publishes; its job stays
  queued and is scheduled again by `owners.setWriter` when Convex is the
  writer once more.
- **Lost runs.** Every lease schedules its own recovery. A run that has
  neither finished nor failed when the lease ends is retried, and anything
  it sends afterwards names a claim that no longer holds the job and is
  ignored.
- **Failures.** `rate_limited` waits for the time the gateway names and
  counts no attempt. `credentials_rejected` blocks the job until the
  activity is requested again. An activity of another athlete, `forbidden`
  and a provider error that a retry cannot change mark the job failed at
  once. Everything else is retried after one minute, doubling up to six
  hours, and the job is marked failed after ten attempts. A failed job
  starts over with the next request for its activity.

The worker needs three Convex environment variables, and without them every
run fails as retryable and writes nothing:

```sh
ACTIVITYMAP_APP_ORIGIN='https://<the app>'
ACTIVITYMAP_PROVIDER_GATEWAY_KEY_ID='<keyId>'
ACTIVITYMAP_PROVIDER_GATEWAY_SECRET='<64 hex characters>'
```

The key pair must be one of the app's `ACTIVITYMAP_PROVIDER_GATEWAY_KEYS`.
`convex run ingestion:status '{"userId":"<userId>"}'` lists an owner's jobs
that are waiting, blocked or failed.

### Edit and refresh

The v1 edit and refresh routes make the Strava call in the app, with the
account's credential and the shared request budget. The result goes to
Convex in one signed write (`applyActivity` on the write bridge,
`ingestion.apply`) and the response is what Convex then serves
(`src/server/application/convex-activity-commands.ts`).

- A command acts only on an activity that is in the library, and that is
  checked (`activityKnown`) before anything is changed at Strava.
- The write gets a new source revision like a job's, so a job run that read
  the activity earlier cannot overwrite it.
- An edit does not read photos, so what is stored about them stands. A
  refresh replaces the photo set only when it read all of it.
- "Not found" from Strava is written as the deletion.
- When the activity then needs a recording or a match, its job is queued
  for that phase without reading the activity again.
- While the account is in `handoff`, both routes answer 503 and ask to try
  again: nobody could record the result.

### Sync status and "Check Strava for missing activities"

`GET /api/v1/ingestion-status` is built from Convex: one read of the counts kept with every write
(`sync.read` operation `statusSummary`, `convex/stats.ts`) plus the sweep's
state, with the library walked page by page only while those counts are
being rebuilt. Outstanding details, photos and recordings are reported as
scheduled, since the sweep fetches them.

"Check Strava for missing activities" in Settings (`POST /api/v1/strava-import`)
starts the reconciliation sweep now (`sweepNow` with `explicit`), unless one is
under way, already due, or finished within the last hour; its status is the
sweep's (`src/server/application/convex-import.ts`). The first fetch after
sign-up uses the same operation with a five-minute limit.

### Share links and export

Share links live in Convex (`convex/shares.ts`). The app creates the token
and stores only its hash. What a recipient sees is assembled in Convex by
the allow-list in `src/contracts/share/activity.ts`.

The CSV export reads the whole library from Convex, page by page through
the read bridge.

### Reconciliation

Events can be missed, so each owner Convex writes for also has a sweep
(`convex/ingestionSweep.ts`). It is due when Convex becomes the owner's
writer and then six days after the last one finished. A sweep writes no
activity itself; it asks the activity's job, which reads the activity in
full.

- **Scanning.** The worker reads the provider's list of the owner's
  activities, 100 a page and newest first. An entry that has never been
  seen here is added as a summary activity straight from the list, so a new
  library, or an activity whose event was missed, appears without a
  provider read per activity. The worker then records a fingerprint of each
  summary on the activity's job. An activity is asked for when it is unknown here, when its
  fingerprint differs from the one the previous sweep recorded, or when its
  job is blocked or failed. The first time a known activity is seen, the
  summary is compared with the stored activity instead. An unchanged library
  costs only the list reads. An empty page ends the scan.
- **Confirming.** An activity that the list did not contain is not treated
  as deleted. The sweep asks for each such activity, and the job's detail
  read decides. The same walk asks for activities that are in the list but
  incomplete here: never read in full, photos out of date, or no recording.
  At most 20 are asked for per hour in total, so neither a
  wrong list nor a large backlog can spend the request budget at once. The
  walk goes from the newest activity to the oldest, so what an account
  looks at most is completed first. Activities that started after the sweep
  began are left alone.

A list entry of another athlete stops the page before anything is recorded.
A rate limit waits for the gateway's time, rejected credentials are tried
again a day later, and any other failure is retried with the same delays as
a job, without giving up. The sweep stops with its writer like a job does,
and `convex run ingestionSweep:status '{"userId":"<userId>"}'` shows it.

### Retention

A daily job removes `providerEvents` receipts after 30 days. Jobs are kept:
there is one per activity, and it holds the fingerprint the next sweep
compares with.

## Place catalogue

A place catalogue is built from OpenStreetMap extracts
(`pnpm places:prepare`, `places:combine`) and published here with
`pnpm places:publish` (`src/server/places/catalogue-publish.ts`,
[docs/place-catalogue-refresh.md](../docs/place-catalogue-refresh.md)). A
place's ID is a name-based UUID of its OpenStreetMap object, so the same
place has the same ID in every catalogue.

### Live catalogue

The live catalogue (`convex/livePlaces.ts`) is one table, `livePlaces`, that
a publication updates in place; rows are stored by quarter-degree tile. The
publisher reads `liveState` and pages of row hashes (`liveHashes`) through
`/internal/places/v1`, and sends only the difference through the write
route: `beginApply`
announces the artifact and the row count and set digest the rows must reach,
`applyBatch` upserts and deletes up to 500 rows a call, and `completeApply`
accepts the publication when the rows match. `placeCatalogueState` holds the
completed publication (its `revision`, snapshot and the stored manifest and
coverage) and the pending one. A pending apply of another artifact is only
discarded with `replacePending`.

Every write records its old and new tile in `placeTileChanges`, and the
publisher adds the tiles where the coverage changed. Each match records the
tiles it read in `activityPlaceTiles`. On completion the re-match walk
`catalogue.rematchTiles` goes through the revision's changed tiles and asks
for a new match (`ingestion.requestMatch`, no provider read) of every
activity there whose match was read at an older revision, pausing two
seconds after each step that asked for any. It skips owners Convex does not
ingest for. Old matches stay visible until the new result replaces them
(`publishMatchRecord` accepts a newer revision under the same catalogue). The
walk deletes each tile's row once it has finished the tile, so the rows left
are its unfinished work; a daily job (`maintenance.resumeRematchWalks`)
starts the walk again for completed revisions that still have rows.

`livePlaces.demandTiles` pages through `activityPlaceTiles` in tile order
and answers each tile with the number of its rows on the page, with no owner
or activity: the tiles that hold activities, from which the publisher's
region selection decides what the catalogue must cover.

Matching reads rows while a publication is applied. A match records the live
revision that was current when it started, so one that overlapped an apply
is older than the completed revision and is matched again: by the walk, or,
if it was published after the walk passed, at once (`ingestion.matched`).

### Which catalogue an owner is matched against

`owner.matchingVersion` names the recipe and the catalogue. For the live
catalogue it names the fixed lineage `LIVE_CATALOGUE`
(`src/server/places/catalogue-rows.ts`), not a snapshot, so a publication
changes no owner. The worker (`ingestionWorker.match`) reads the live table
when the owner's matching version is the live one and a publication has
completed, and otherwise the rowset its matching version names. A stored
match's `revision` tells them apart: 1 or more for the live revision it was
read at, 0 or absent for a rowset. `catalogueSnapshotId` in a result is the
snapshot of the publication that produced it.

`places.latestCatalogue` is the live catalogue once a publication has
completed, before that the newest complete rowset. New libraries start on it
(`latestCatalogue` over the write bridge), and `catalogueWorker.adopt` moves
every library Convex writes to it (`catalogue.adopt`). For each library the
walk `catalogue.next` hides the old matches, tells clients, and queues a
match for every activity with a current recording, without a provider read.
A job that is running when the walk reaches its activity is marked `rematch`
and queued for the match when its run ends. Owners are moved a page at a
time; an adoption starts only for the catalogue that is still the latest and
records itself in `catalogueAdoptions`, and a later page of an adoption that
another one has replaced there changes nothing. Adopting is safe to repeat.
Run `convex run catalogueWorker:adopt` once after the first live
publication, and after a deployment that changes the matching recipe.

### Rowsets

Before the live catalogue, each publication was an immutable rowset: the
`places` rows of one snapshot, with its manifest and coverage referenced
from `placeCatalogues`, imported through `catalogueState`, `beginCatalogue`,
`importPlaces` and `completeCatalogue` (`convex/places.ts`). Owners whose
matching version names a rowset keep reading it until they are adopted.
After the cutover, `convex run places:dropRowsets` deletes the rowsets and
their files, continuing by itself until none are left. It refuses before a
live publication has completed and until the latest adoption was to the live
catalogue.

## Recordings and publication

Activity rows hold bounded DTO metadata and versioned stream/matching
projections. Immutable gzip recordings and chart summaries use a separate
recording table and storage. Validators derive from the shared Zod contracts;
mutation boundaries also enforce their semantic refinements.

The coordinator supplies monotonically increasing `sourceRevision` values.
`streamSourceRevision` records the first revision of the current stream source,
using `STREAM_SOURCE_FIELDS` (`src/server/strava/stream-policy.ts`). It stays stable across names
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

## Deploying

Every push to `main` deploys this package to the production Convex
deployment (`.github/workflows/convex-production.yml`); the workflow can also
be started by hand. It runs in the `Production` GitHub environment and needs
one secret there: `CONVEX_DEPLOY_KEY`, a production deploy key from the
Convex dashboard (Settings, Deploy keys). The workflow refuses a key for any
other deployment.

The app on Vercel and this package deploy independently, a minute or so
apart, in no fixed order. Keep changes to the bridges and the schema
additive: add an operation or a field in one change, and remove what it
replaces only after both sides run the new code.

New bridge operations need a compatible path while their first backend deployment
is pending approval. The auth `rateLimits` caller retains its mixed-version
handling. HTTP delta reads now require `changesPage`, which is deployed in
production; a 400 from that operation is an error rather than a signal to issue
unrelated fallback reads. New operations should include a mixed-version proof,
and compatibility shims can be retired once their minimum backend is deployed.
