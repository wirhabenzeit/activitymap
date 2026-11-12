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

The sections "Serving preview owners", "Live owners" and "Read owners in
production" describe per-account settings from the move off Postgres that
the app still reads (`src/server/preview/selection.ts`,
`src/server/convex-live-owners.ts`, `src/server/convex-read-owners.ts`).

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

The app writes through a separate signed route, `/internal/write/v1`. It has its own key map and signature domain, so
the read bridge's key can never authorize a write, and every request carries a
single-use nonce (`bridgeNonces`, expired hourly). Add a writer key next to the
reader key:

```sh
pnpm exec convex env set ACTIVITYMAP_BRIDGE_WRITER_KEYS '{"devw1":"<hex>"}'
# backend/.env.local
ACTIVITYMAP_CONVEX_WRITER_KEY_ID=devw1
ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY=<hex>
```

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

## Provider gateway

A Convex worker that needs provider data asks the app for it
(`docs/convex-writer-cutover.md`, decision 1): the app keeps the Strava
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
whose library Convex writes (`users.writer`), so a handoff switches it on for
an account and a hand-back switches it off. The caller is the Convex
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
package (`docs/convex-writer-cutover.md`, step 5; `convex/ingestion.ts`).
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
4. **Match.** When the activity has a current recording without a match
   for the owner's catalogue, the worker matches it against the copied
   place catalogue (`backend/matching/activity-match.ts`) and publishes the result. A title
   edit keeps recording and match; a new recording is matched again. If no
   complete rowset is the one the owner's matching version names, the
   activity is finished without a match.
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

### Sync status and "Fetch from Strava"

`GET /api/v1/ingestion-status` is built from Convex: one read of the counts kept with every write
(`sync.read` operation `statusSummary`, `convex/stats.ts`) plus the sweep's
state, with the library walked page by page only while those counts are
being rebuilt. Outstanding details, photos and recordings are reported as
scheduled, since the sweep fetches them.

"Fetch from Strava" (`/api/v1/strava-import`) starts the reconciliation sweep now (`sweepNow`), unless
one is under way or finished within the last five minutes, and its status is
the sweep's (`src/server/application/convex-import.ts`).

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
[docs/place-catalogue-refresh.md](../docs/place-catalogue-refresh.md)). The
publisher sends the artifact's places through the write bridge operations
`catalogueState`, `beginCatalogue`, `importPlaces` and `completeCatalogue`
(`convex/places.ts`), then calls `adoptCatalogue`.

A rowset is one catalogue snapshot under one row format: the artifact's rows
that the noise filter does not hide. A place's ID is a name-based UUID of its
OpenStreetMap object, so the same place has the same ID in every catalogue.
Rows are stored in `places` by quarter-degree tile; the catalogue manifest
and coverage are one stored file referenced from `placeCatalogues`.

Rows are sent in ascending place-ID order, 500 a call, and sending continues
from the last imported ID after a deadline or an error. Both sides keep a
digest over the rows, and a rowset is marked complete only when its row count
and digest agree; nothing may read it before. Superseded rowsets are not
removed yet.

`adoptCatalogue` (`convex/catalogueWorker.ts`) names the newest complete
rowset under the matching recipe in the deployed code and moves every library
Convex writes to it (`catalogue.adopt`). For each library the walk
`catalogue.next` hides the old matches, tells clients, and queues an
ingestion job that starts at the match phase for every activity with a
current recording (`ingestion.requestMatch`), so nothing is read from the
provider. A job that is running when the walk reaches its activity is marked
`rematch` and queued for the match when its run ends, also without a provider
read. The walk pauses two seconds between steps of sixteen activities.

Owners are moved a page at a time. An adoption starts only for the rowset
that is still the newest and records itself in `catalogueAdoptions`; a later
page of an adoption that another one has replaced there changes nothing. A
library that already has the catalogue is left alone, so adopting is safe to
repeat; run `convex run catalogueWorker:adopt` after a deployment that
changes the matching recipe.

The script reports progress after each minute of sending and can be stopped
and run again. The eight-country catalogue has about 176,000 such rows.

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

New app callers also need a compatible path while a backend deployment is
pending approval. The `rateLimits` and `changesPage` callers handle the older
bridge's HTTP 400 response by using the existing operations, with the same
authorization, retention and ordered rate limits. They try the optimized
operation again on the next request, so either deployment can finish first.
Authentication, cursor, server and transport failures are not treated as
unsupported operations. Tests cover an app-first rollout and the automatic
switch after the backend upgrade. Adding a new bridge operation should include
this mixed-version proof rather than a manual release-order instruction.
