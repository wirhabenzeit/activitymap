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

Both use the same adapter (`src/server/preview/convex.ts`), so the v1 sync,
list, summary, stream, places and status routes behave identically. This
package serves activity metadata, streams, recordings, summaries and matches.
Photos are not persisted yet, so photo reads are empty; ingestion status
reports stored data only, because provider ingestion does not run here.

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

`POST /api/cron/mirror-convex-shadow` runs the mirror for the users listed in
`ACTIVITYMAP_CONVEX_SHADOW_OWNERS` (a JSON array of application user IDs). It is
off unless that list is set and `ACTIVITYMAP_EXTERNAL_EFFECTS=enabled`, and it
requires `CRON_SECRET` plus the writer settings above in the app's
environment. The Cloudflare cron worker calls it every ten minutes.

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
differing field; route, coordinate and description values are replaced by
their length). Drift or a failed check answers 500. The response carries the
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
