# Convex lab durable fixture ingestion

Milestone 2 of [issue #480](https://github.com/wirhabenzeit/activitymap/issues/480)
ran generated activity events through the hosted development lab. It covered
receipt deduplication, coalescing, provider calls, recording publication,
recovery, and erasure. The lab uses the existing whole-gzip recording codec,
manifest, compact summary, and file reaper. All entry points are internal.

## State and recovery

The receipt mutation records the delivery key and desired activity revision
and schedules a dispatch in the same transaction. [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions#scheduling-from-mutations)

A single job per account
and activity keeps the desired revision, phase, attempt, lease deadline, and
retry deadline. Dispatch reserves a lease and schedules both the Node worker
and a lease-expiry check. A rejected or delayed action cannot advance a newer
attempt. New revisions supersede prior jobs, and deletion wins at equal
revision. Source versions use the explicit `fixture-v1:<revision>` namespace.
Activity IDs stay decimal strings, including IDs above JavaScript's safe
integer range.

The worker reserves quota before each fixture detail, streams, or refresh
call. Four application-wide windows cover overall and read traffic for
15-minute and UTC-day periods. The fixture ledger mirrors the production
headroom and keeps interrupted reservations charged. A 429 delays the
application until Retry-After, or the short-window reset when the header is
absent. A credential rejection blocks the account, while a permission or
upstream failure increments the activity's capped backoff. Concurrent refresh
calls share an account lease. Publishing a refreshed credential checks its
prior token, lease holder, and account generation.

Before uploading a recording, the worker registers a file attempt and its
compressed digest. Publication checks the active account generation,
credential, lease attempt, desired source revision, current fixture snapshot,
and registered upload. It publishes the activity detail, manifest and summary
in one mutation. A previous good recording remains stored while a newer
fetch fails. The current-recording read hides it until its source is current.
An empty recording publishes normally.

A rejected upload whose writer has returned from storage can be retired
immediately. A lease check can also retire the upload of a terminal scheduled
worker. The reaper discovers its file from the attempt-specific storage
marker, without receiving a file ID from the interrupted action. A writer
that might still be running retains the milestone 1 fallback deadline of
15 minutes. Successful publication removes the upload-attempt row
transactionally, so the reaper cannot remove its referenced file.

Due-time reconciliation reads the authoritative fixture listing in pages
and schedules the next page or next due time transactionally. It shares
provider quota with activity requests. Idle jobs have no inbox scan. Revocation increments the account generation and invalidates credentials
before scheduling bounded erasure of the account's jobs, receipts, fixtures,
summaries and current recording files. Stale scheduled work checks the job
or account fence on entry.

## Hosted verification

The November 7, 2026 suite used `spotted-fennec-603`, generated small, typical and empty
recordings, 6-second test leases and a generated 4-second Retry-After.
It checked:

- Three concurrent receipt calls yielded one queued job, one duplicate
  receipt and one coalesced receipt. An older update was ignored. A delayed
  upload from an older revision could neither replace the new result nor
  delete its file.
- A failed activity refresh preserved the old file without serving it as
  current. A newer empty recording published with an empty channel manifest
  and replaced that file. A forced commit rollback during replacement
  preserved the previous file until the successful retry.
- An equal-revision delete fenced an already uploaded recording. Revocation
  fenced an in-flight upload and a delayed token refresh. An account could
  neither read another account's recording nor process a receipt from a
  revoked generation.
- An application-wide 429 deferred two accounts to the same deadline without
  activity backoff. The 76th read reservation was denied at the fixture
  window cap of 75, while a non-read refresh reservation remained available.
  Two activities sharing an expired token spent one refresh reservation.
  A credential-rejected account stopped dispatching while its sibling
  account continued.
- The real due-time scheduler discovered an undelivered create and delete
  with zero receipts. Probe polling observed results produced by the scheduler.
- Injected faults before and after detail, streams, refresh and upload, during
  the commit mutation, after commit, and during overlapping upload and
  refresh attempts all left one current revision per surviving activity.
  A pre-commit fault triggered the scheduled lease recovery. The post-commit
  fault required no second attempt. The storage audit compared actual file
  IDs with every expected published pointer and checked for zero files and
  upload-attempt rows after erasure. The final run found 17 published files
  before erasure and zero residual files or attempts afterward.

The 6-second timers ran on the hosted scheduler in wall time. The separate
15-minute last-resort deadline was outside the timed suite.
[Saved hosted timings](durable-ingestion-results.json) measure probe-observed
completion from setup of each fault case and include concurrent scheduling
and observation overhead. Eleven cases recovered on the second attempt in
8.54–11.03 seconds. The post-commit case was visible at 0.95 seconds on
the first attempt. The lab TypeScript check, the hosted milestone 1 recording
guard, nine recording codec tests, and 43 existing Strava tests passed.

## Boundary for the next milestone

The fixture snapshot supplies authoritative revisions and explicit deletion
markers. Live webhook ordering, omission confirmation, HTTP header parsing,
cross-system quota coordination, credential relinking, and handling an
unconfirmed provider token rotation remain live-pilot integration work. The fixture reconciliation page is a
transactional database read. A live provider page will need an external
request and its own fenced checkpoint. The failure cases use injected
exceptions and delayed actions, including a rollback in a deployed mutation.
Runtime outage behavior is outside these fault cases.

Milestone 3 can use the owner-scoped current manifest and the existing
recording decoder. Its matching commit needs a fence for the account,
source, recording generation/revision, matcher recipe and catalogue revision.
Matching results and the client change feed belong to later milestones.
This run used generated recordings and credentials in the isolated lab.
Existing place datasets were outside the run.

[Reproduction commands](lab/README.md#durable-fixture-ingestion)
