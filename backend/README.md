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
be issued again. Source and publication mutations check the same assignment,
account generation and current source revision. Convex document IDs stay inside
the application backend.

The existing authenticated app derives the bridge actor from the resolved
session. The bridge accepts a short-lived HMAC over the complete request body
and the signer ID. Configure `ACTIVITYMAP_CONVEX_SITE`,
`ACTIVITYMAP_CONVEX_KEY_ID` and `ACTIVITYMAP_CONVEX_SIGNING_KEY` in the app's
server secret store. Configure `ACTIVITYMAP_BRIDGE_SIGNING_KEYS` on the
application deployment as a map from key IDs to 32-byte lowercase hex secrets.
For rotation, install the new key on Convex, switch the server's signer and
retire the prior verification key after in-flight requests expire. Use
different keys for each environment.

The application bridge and owner assignments are foundations for the handoff.
The app routes currently exercise the existing contracts through Postgres or the
isolated fixture adapter. Routing real owner reads and writers together requires
the provider authority and migration work in the implementation plan.

## Storage and sync

The activity row holds bounded DTO metadata and a versioned stream/matching
projection. Bootstrap reads it directly. Immutable gzip recordings and chart
summaries use the separate recording table and storage. Source revisions,
recording IDs, catalogue identity and account generation fence late work.
Upserts and tombstones are sequenced in the same transaction as the visible
change. Revocation hides data immediately. Physical erasure and orphan recovery
belong to the account lifecycle and durable worker workflows.

A catalogue change updates the shared catalogue and matching version first.
The bounded rebuild publishes invalidation changes for rows that still carry
old results. Subsequent matching publications replace those results under the
new catalogue fence. This package currently serves activity sync and summary
reads. Photo persistence, provider command dispatch, account lifecycle and
authoritative catalogue publication are later work packages.

## Review fixes and remaining integration boundary

PR #494 deliberately remains a REST compatibility foundation. The web preview
still uses the lab contract from #495. It now requires
`ACTIVITYMAP_CONVEX_PREVIEW_SITE` (an HTTPS origin, with no path or credentials);
there is no built-in deployment URL. For the existing lab, configure its site
origin explicitly. This setting is separate from `ACTIVITYMAP_CONVEX_SITE`,
which selects the application backend's signed bridge. The lab performance
numbers do **not** validate this package or its missing photo/raw/status APIs.
Connecting those contracts, coordinated provider cutover, Convex authentication
and web subscriptions remain implementation-plan work, not claims of this PR.

The concrete review fixes are:

- Source invalidation uses the same `STREAM_SOURCE_FIELDS` as Postgres. Names
  and kudos preserve recordings, summaries and place matches; geometry,
  privacy and sensor-source changes invalidate them. Late work still checks
  the current source revision.
- Missing/outdated projections return activity metadata without derived state,
  so a projection-version rollout does not take the owner offline. Obsolete
  account generations are excluded from reads.
- `ownerHeads` holds the feed sequence, retention floor and rebuild cursor.
  Item and summary queries no longer read the mutable head. Feed writes still
  serialize per owner to maintain the offline cursor's total order.
- A daily Convex cron compacts changes older than 90 days in 256-row batches,
  atomically recording each owner's removed-sequence floor. `retention` exposes
  that floor, and `changes` rejects older cursors even after all rows expire.
- Catalogue selection schedules bounded invalidation batches automatically.
  Superseded/revoked work stops; a new Convex routing epoch resumes pending work.
  This invalidates old results; it does not implement the future rematching worker.
- Recording preparation schedules a reference-aware cleanup before decoding.
  Rejected/failed publication also cleans immediately. Referenced files survive
  cleanup. Uploads abandoned before preparation and full account erasure still
  require the account/ingestion lifecycle work.
- Activity, stream and match validators derive from the existing Zod contracts;
  Zod parsing at mutation boundaries still enforces their semantic refinements.
- HMAC signing and verification decode the configured hex into 32 bytes. Deploy
  signer and verifier together; keys from the previous text-byte implementation
  produce different signatures. This bridge accepts reads only. Signed requests
  can be replayed within 30 seconds; a single-use nonce is required before adding
  any write operation.
- Test fixtures live under `backend/tests`, independently of the lab. The app
  shell resolves preview selection once per render.

The head-table/index changes target this undeployed foundation. Do not apply
this schema over an existing backend dataset without migrating its owner heads
and rebuilding the changed index. The lab schema and retained data are untouched.
