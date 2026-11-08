# Convex backend implementation and migration plan

Updated 2026-11-08. Continues [issue #480](https://github.com/wirhabenzeit/activitymap/issues/480)
and the investigation in [issue #478](https://github.com/wirhabenzeit/activitymap/issues/478).
This replaces the original experiment delivery sequence with the remaining implementation plan.
The GitHub issue has not been updated by this planning pass.

## Direction

Proceed toward a complete Convex backend, keeping the existing HTTP API, offline
sync protocol, web UI and iOS data model. The experimental evidence is sufficient
to begin implementation. Further measurements belong to acceptance checks for
specific changes and the live pilot, rather than another open-ended investigation.

Use a staged rollout. Retain Better Auth/Postgres identity temporarily while the
Convex application backend is completed; port authentication before removing
Postgres. Retain exactly one authoritative writer per owner and one provider
quota/credential authority per Strava application. Do not run two independent
provider pipelines for the same owner.

This document plans implementation, provisioning and eventual cutover. It does
not itself enable live provider calls, change webhook routing, extend retention,
create production deployments or migrate users.

## What is established

| Area              | Evidence and consequence                                                                                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recording storage | Lossless whole-recording gzip files, separate manifests and compact summaries; keep this layout. Chunking is an exceptional fallback, not the default.                                                                                                                                                                                             |
| Durable execution | Fixture receipt deduplication, leases, recovery, quota reservations, publication fences and orphan cleanup work. Implement the real provider boundary on these foundations.                                                                                                                                                                        |
| Geo matching      | All 27,612 canonical comparisons across six full-library passes passed. Keep ordinary quarter-degree tiles, exact candidate filtering, stable place IDs and the existing matcher.                                                                                                                                                                  |
| Batch policy      | Original grouping was cheapest; smaller batches did not materially lower hosted process RSS. Preserve geographic grouping; use explicit sample/byte/activity limits, with 75k / 12 MiB / 36 activities as a conservative initial cap and oversized recordings isolated. This is an implementation default choice, not a demonstrated cost optimum. |
| Existing clients  | Web bootstrap, delta sync, summaries, saved matches, deletion and backend cursor isolation work. Native runtime verification remains.                                                                                                                                                                                                              |
| Production build  | Median cold load: hosted Convex 16.9 s; local Postgres 11.5 s, or 5.2 s with larger pages. These are different hosting topologies, not a database ranking.                                                                                                                                                                                         |
| Everyday changes  | Full-cache fixture tests passed: new activity 1.4 s, replacement 1.5 s, offline catch-up 0.8 s after publication/sync trigger. Live provider latency and changed-catalogue rematching remain outside this proof.                                                                                                                                   |
| Optimization      | Convex bootstrap reads 18,876 documents for 4,602 activities. Roughly 8 s is hosted query execution; browser storage is small. The local production server also returned uncompressed browser-facing JSON.                                                                                                                                         |

Evidence: [recording storage](recording-storage-findings.md),
[durable ingestion](durable-ingestion-findings.md),
[hosted matching](hosted-matching-findings.md),
[full-library validation](full-library-validation-findings.md), and
[client and production-build validation](client-preview-findings.md).

## Target architecture

```text
Existing web / iOS clients
  → existing authenticated HTTP contracts
  → server-selected backend for the resolved owner
  → Convex activity read models + ordered changes + compact summaries

Strava webhook / user refresh / due reconciliation
  → shared provider quota and credential authority
  → durable desired-state job → provider fetch → immutable recording file
  → guarded mutation: activity + recording metadata + read model + change
  → hosted matcher → guarded mutation: result + read model + change
```

Queries should read a prepared client representation rather than reconstructing
each activity from several tables on every download. Writes retain the current
owner, account generation, source, recording revision and catalogue fences.
Heavy decoding and matching stay in Node actions. Durable IDs/checkpoints, not
recording arrays, travel through scheduling.

## Delivery order

Each row is a reviewable work package, usually split into the PRs named below.
The critical path to a single-owner pilot is 1 → 2 → 3 → 6, plus the required
parts of 4. Authentication work can proceed once stable IDs and the account model from
1 are fixed. Full cutover requires every package, including rollback rehearsal.

| Order | Work package                                     | Complete when                                                                                                                                                               |
| ----- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Production foundation and efficient client reads | Typed production modules, isolated fixture tools, maintained activity read models, bounded pages, compressed responses and existing sync semantics verified.                |
| 2     | Real provider ingestion                          | One owner can refresh/import and receive create/update/delete events with shared quotas, credential fencing, durable reconciliation and recovery.                           |
| 3     | User-facing feature completion                   | Photos, activity edits/refresh, sharing, export and account deletion work through the selected backend; every existing route has an explicit implementation or disposition. |
| 4     | Catalogue lifecycle and operations               | Catalogue changes invalidate/recompute correctly; status/admin views, retries, cleanup, backfills and usage accounting cover the deployed backend.                          |
| 5     | Authentication and native compatibility          | Better Auth storage/login/session flows run on the target backend; web and iOS complete login, sync, logout, revocation and recovery.                                       |
| 6     | Migration and rollback machinery                 | Resumable import, catch-up, owner handoff and post-write rollback are rehearsed with complete data/identity checks.                                                         |
| 7     | Single-owner pilot and staged cutover            | Live daily flows and erasure pass, operational failures are recoverable, costs are recorded, then owners are moved in controlled cohorts.                                   |

### 1. Production foundation and efficient client reads — start here

**PR 1A: production module boundary.** Establish the application Convex package
and deployment configuration outside `scripts/investigations`. Move reusable
recording, ingestion, matching and sync modules without changing algorithms.
Keep fixture seeders, failure injection, replay/reset/erase controls and temporary
bridge tooling in the lab deployment. Replace permissive fixture validators with
typed, size-bounded production inputs. Add deployment/schema checks to CI.

Introduce a durable server-side owner/backend assignment with a routing epoch.
All reads, commands and background work use the same assignment. Preserve stable
application user IDs and canonical external activity/photo IDs; Convex document
IDs remain internal. Replace handwritten per-owner preview keys with a managed,
rotatable server trust boundary. Derive ownership from the authenticated actor;
never accept a client-supplied owner as authorization or expose an admin key.

**PR 1B: activity sync read model.** Add an indexed, bounded per-owner/activity
projection containing the existing activity DTO fields, current stream metadata,
matching bundle, source/revision tokens and projection schema version. Keep raw
recordings and compact chart summaries outside it. Retain only contract-required
fields; validate maximum serialized size, including large matching bundles.

Update the projection and ordered change record in the same mutation whenever
metadata, recording validity, matching results or deletion changes. Job claims
still verify the canonical source and recording fences before publication.
Account revocation/erasure must make reads unavailable immediately through the
shared owner fence even while physical cleanup runs. A catalogue change must
mark old matches stale/pending at read time using its shared version fence,
then rebuild affected projections in bounded batches; cached old results must
never silently remain current.

Provide an idempotent, checkpointed projection backfill/rebuild. Version-gate
publication so reads cannot mix incompatible projection schemas. Reads retain
one shared owner/head/catalogue check per page plus approximately one activity
read per returned item, rather than roughly four reads per activity.

**PR 1C: delivery and bounded paging.** Keep up-to-500-item pages with a byte
budget and explicit continuation. Verify gzip/Brotli on the actual browser-facing
hosting path, preserving private/no-store behavior and ordinary JSON contracts.
Locate the HTTP adapter near the Convex deployment where available. Keep chart
summary downloads resumable and out of the initial library completion path.

Acceptance:

- Existing DTOs, bootstrap high-water marks, ordered deltas, tombstones and
  backend/epoch cursor rejection remain compatible. Updates/deletes during
  backfill or bootstrap cannot be lost or resurrected.
- The real 4,602-activity fixture matches its expected IDs and recording/matching
  versions; ownership, revocation and stale-recording tests pass.
- Target fewer than 6,000 document reads for that bootstrap, including shared
  checks, versus 18,876 today. Record added projection write/storage costs too.
- Aim for a cold load below 10 seconds in the current production-build test
  setup, and preserve the present incremental behavior. This is an engineering
  target to verify after implementation, not a claimed result or product SLA.
- Compression is verified by transferred bytes/headers. Native clients need no
  new codec, subscriptions or local-schema changes.

**Implementation evidence.** The separate application package, typed
projection writes, signed bridge, lab backfill and sync-route compression are in
the workspace. The hosted lab proved exact parity for all 4,602 activities and
reduced activity bootstrap reads to 4,764. Median production-build Chromium
cold load was 14.901 seconds, so the under-10-second target remains open. The
application package and trust boundary await a dedicated deployment and
coordinated app/worker routing before any owner handoff. See
[projection and wire measurements](client-preview-findings.md#maintained-activity-projection-and-wire-compression).

A separate optional Postgres PR can adopt larger byte-bounded pages using the
same contract. It is useful independently and is not a dependency for Convex.

### 2. Real provider ingestion

**PR 2A: provider authority and owner dispatch.** Initially reuse the existing
provider quota/credential service as the sole authority while other owners still
use Postgres. Give the Convex worker a narrow server-only provider interface;
reserve quota and serialize token refresh centrally. Do not duplicate tokens
into independently refreshing workers. Move this authority to Convex as a
coordinated step before final Postgres removal, preserving application-wide
quota windows across the handoff.

Extend webhook intake with a durable, replayable dispatch/outbox and explicit
owner routing. A webhook is acknowledged only after durable receipt. Preserve
events across dispatch failures and ownership handoffs. Keep the existing
subscription; plan an owner-scoped forwarding path or an isolated provider
application for the pilot, rather than redirecting all production events.

**PR 2B: real requests and reconciliation.** Implement detail/stream/photo fetches,
HTTP and Retry-After handling, token rotation/relinking, pagination checkpoints,
initial import and due-time reconciliation. Fixture version numbers are not a
live Strava ordering guarantee: assign local desired-state generations, validate
fetched source fingerprints and make stale workers lose publication. An omitted
page item alone is not a confirmed deletion. Account deauthorization must fence
all work immediately. Honor provider visibility/permission changes.

Acceptance: new activity, repeated/out-of-order event, edit, missing webhook,
confirmed deletion, empty recording, rate limiting, expired credential and
revocation all converge through real adapters. Exercise a crash around token
rotation and external reconciliation checkpoints. Observe the existing delayed
orphan-recovery deadline once; retain the tested fast recovery cases. No duplicate
provider authority, stale publication or abandoned referenced-file cleanup.

### 3. User-facing feature completion

**PR 3A: photos and activity commands.** Implement bounded photo history/backfill,
metadata updates and removal, including sync tombstones and parent deletion
cascades. Port existing activity editing, refresh and import commands with their
current permission/error/retry semantics. Use durable command IDs where an
external effect may succeed before its local acknowledgement; retries must
reconcile provider state. Deletion behavior follows the existing product/API
contract rather than adding a new provider-delete feature.

**PR 3B: sharing, export and account lifecycle.** Port share-link creation,
revocation, capability reads and export/CSV behavior. Keep private/unshared data
outside capability responses. Account deletion/revocation must coordinate auth,
provider access, pending commands, recordings, summaries, projections, photos,
links, change feeds and migration artifacts. Fence access before bounded cleanup;
late work and stale imports must not recreate erased data. While auth remains in
Postgres, use one durable erasure workflow across both stores.

Acceptance: cover these routes against both backends, including unauthorized
and cross-owner requests, partial external failure, deletion cascades and a full
erasure audit. Remove preview-only disabled UI controls only as their backend
path becomes complete. Existing web and iOS contracts remain the reference.

### 4. Catalogue lifecycle and operational completion

Port catalogue import, manifest verification, immutable publication and active
version selection. A new catalogue or matcher recipe schedules a checkpointed
rematch and publishes new client changes. Test a genuine changed-catalogue run;
the completed same-input rematch test proves idempotency only. Preserve coverage
and complete/partial/uncovered semantics throughout publication.

Use the tested geographic grouping and explicit resource guards. Tune against
sample count, decoded bytes, touched/populated tiles and candidate density;
never treat map-envelope size or activity count alone as a memory estimate.
Start with bounded owner concurrency and one tile reader. Add concurrency only
when the deployed workload needs it, with shared quota and runtime limits intact.

Port ingestion/status views, required admin actions, backfill progress, retry
controls and catalogue diagnostics. Inventory the separate PostGIS place
search/discovery/debug behavior explicitly: implement equivalent required
behavior or record an agreed retirement before removing Postgres. Geo matching
parity alone does not cover arbitrary spatial queries.

Replace owner-eligible periodic drains with durable due-time scheduling while
retaining required reconciliation and maintenance. Add visibility into queue age,
failed/retrying jobs, stale projections, unmatched revisions, orphan cleanup and
publication lag. Collect database reads/writes, files, execution, calls, egress
and retention usage by workload. Use the live pilot to validate recovery and
operating cost; do not reopen the completed batch-profile research by default.

### 5. Authentication and native compatibility

Keep Better Auth's external session and login contracts where practicable.
Implement and verify its target storage adapter, stable user/account mapping,
Strava OAuth callbacks and scopes, mobile one-time-code exchange, session listing,
logout/revocation, credential relinking and account erasure. Choose the concrete
adapter based on supported behavior during this work; compatibility is not
assumed from the fixture bridge. If an existing session cannot be migrated safely,
plan an explicit sign-in transition without changing the user's identity or
losing cached data.

Native work is expected to be validation and endpoint/configuration changes:
exercise `SyncAPI.swift`, `SyncEngine.swift` and the auth flow against the real
preview. Cover bootstrap, interrupted sync, cached reopen, summaries, place
matches, session expiry, logout and both directions of backend rebootstrap.
Only change Swift models if a documented contract gap requires it. Realtime
Convex subscriptions and a client rewrite are outside this migration.

Acceptance: a non-fixture owner can log in and use both clients with identity
stored on the target backend. Auth no longer depends on Postgres before the final
removal milestone. Provider refresh ownership remains singular throughout.

### 6. Migration and rollback machinery

Implement a manifest-based resumable importer for users/accounts as appropriate,
activities/photos, lossless recordings, summaries, eligible matching results,
sharing/settings and required operational state. Preserve stable IDs and
relationships. Validate hashes, counts, source versions, catalogue identities
and representative complete DTOs. Recompute derived results when identities
are incompatible rather than relabeling them as current.

Capture a source checkpoint plus every change since that checkpoint. Before an
owner handoff, pause/fence that owner's old writer, drain accepted work, apply
catch-up, verify parity and atomically switch its routing epoch. Buffer incoming
events durably during the handoff. Force the existing backend-aware rebootstrap;
never translate an old cursor into a fabricated new high-water mark. Import jobs
also honor revocation/erasure fences.

Rollback has two distinct procedures:

1. Before Convex accepts authoritative writes, switch routing back and rebootstrap.
2. After Convex accepts writes, fence/drain its worker, replay/export all accepted
   data changes to Postgres, verify parity, then switch back. Retain an auditable,
   bounded mutation journal/checkpoint for this purpose. Do not repeat external
   provider side effects during replay. Propagate deletion/erasure tombstones.

Prove the second procedure before enabling a live writable pilot. Keep backup
restore and restore-time erasure handling in the runbook. A feature flag alone
is not a post-write rollback strategy.

### 7. Live pilot, staged rollout and retirement

Use a persistent production-intended deployment and separate environment secrets.
Do not promote fixture-only control functions or rely on expiring lab data.
Start with the current user's owner assignment after the writable-pilot gates
above, initially keeping auth on Postgres if package 5 is still in progress.
Maintain the single provider authority and a rehearsed reverse-data path.

Observe actual create/update/delete, photos, history import, permission changes,
offline catch-up and recovery. Use the pilot's real hosting regions and payloads
for final latency/usage acceptance; collect a practical usage ledger rather than
another standalone benchmark campaign. Check ordinary operation and a relevant
burst/rematch. Fix material regressions in the affected work package.

Expand to controlled owner cohorts only after the initial owner is stable. Remove
Postgres writers/cron responsibilities per migrated owner, and retire Postgres
itself only when auth, provider authority, all retained product/admin/discovery
paths, erasure, backup and rollback requirements have replacements. Remove the
temporary bridge, routing exceptions and obsolete jobs after the rollback window.

## First executable assignment

Begin with **PR 1A + 1B**, followed immediately by 1C: establish the production
module boundary and activity sync projection, wire the existing bootstrap/delta
adapter to it, and prove atomic updates/invalidation/deletion with the current
fixture suite. Deliver a bounded rebuild path and before/after read/write counts.
This directly addresses the measured bottleneck and creates the write contract
needed by real ingestion. Do not start live provider routing as part of that PR.

Follow with provider authority/dispatch (2A), real requests/reconciliation (2B),
feature completion (3), catalogue/operations (4), then migration/pilot (6–7).
Authentication/native work (5) starts once the identity model is stable and must
finish before Postgres retirement. No new subagent is launched by this plan.

## Retained lab data and authorization boundary

The 4,602 retained recordings currently have expiry scheduled for
**2026-11-14 22:18 UTC**. Plan an explicit persistent import or an authorized
retention extension before relying on them beyond that date. No extension,
recording deletion, live credential transfer, deployment promotion or production
cutover was performed in this planning pass. The original preview and private
benchmark reports remain available.
