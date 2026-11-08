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

Copy an owner from the local development Postgres, then compare what the v1
handlers serve from both backends:

```sh
pnpm convex:import-owner --user <userId>
pnpm convex:verify-owner --user <userId>
```

The importer writes through `owners.provision`, `applySource`, recording
preparation and `publishMatch` (batched in `convex/importer.ts`), so imports
exercise the same fences as live ingestion. Each run uses a newer source
revision; re-runs keep unchanged recordings and matches and only publish what is
missing. Both scripts refuse to read anything but the local database. They call
internal functions through the logged-in Convex CLI, so no deploy key is
needed. The verifier runs the real bootstrap and stream-summary handlers against
Postgres and against this package, and exits non-zero on any difference.

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
