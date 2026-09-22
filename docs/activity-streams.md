# Raw activity streams

Issue #182 added ingestion, #183 added the API/lifecycle, and #184 adds hourly historical backfill. The service requests `time`, `distance`,
`latlng`, `altitude`, `watts`, and `heartrate` together from
`GET /activities/{id}/streams?keys=…&key_by_type=true` using `StravaClient`.
Strava's current [endpoint definition](https://developers.strava.com/docs/reference/#api-Streams-getActivityStreams)
has no resolution request parameter. “Raw” here means the samples returned by
Strava, preserved without application downsampling, interpolation, sorting,
rounding, or truncation. It does not promise access to the original recording.

## Storage and validation

`activity_streams` has one row per activity, with a cascading activity foreign
key. The typed JSONB `payload` stores the keyed upstream objects, including
independent arrays, `original_size`, `resolution`, `series_type`, an optional
`type`, and any additional JSON metadata. This avoids imposing a shared array
length or sampling basis on streams that do not have one. JSON object ordering
is immaterial; sample ordering and numeric values are preserved.

`time` is elapsed seconds, `distance` is cumulative metres, `altitude` is metres,
`watts` is power, `heartrate` is beats per minute, and `latlng` pairs are
`[latitude, longitude]`. The runtime schema checks the object and sample types,
finite numbers, integer sensor/time values, coordinate pairs and ranges, and
metadata. An invalid stream rejects the entire response. Unknown stream keys
are rejected; additional metadata within the six known streams is retained.

Missing keys stay absent. A successful empty `{}` response or an empty sample
array is recorded as successful; neither is converted to zero-filled data or
retried automatically. Unequal lengths and irregular elapsed times are valid
and stored as returned. `describeActivityStreams` reports available types,
counts, and sampling-shape mismatches; matching lengths alone do not establish
index alignment. Later chart consumers must make an explicit alignment choice.
Available types are also stored as small metadata for array-free activity reads.

All IDs in this service are canonical decimal strings, bounded to PostgreSQL
`bigint`. The stream repository uses bigint storage and text/SQL comparisons,
never JavaScript `Number`, even though the existing activity model still uses
numeric IDs. Stream samples are not added to activity reads, map queries,
activity DTOs, or sync change records.

## Fetch lifecycle

Call `fetchActivityStreams(actor, activityId, options)` from server code. The
repository resolves ownership and an eligible Strava account from the actor;
callers cannot supply another athlete's credentials. Expired credentials use
the existing client refresh path, with a guarded callback updating both native
and legacy token columns. Rate-limit headers are passed to `onRateLimit`,
including when the upstream request fails. The service makes no automatic
request retries or scheduling decisions.

- No row means no fetch has been attempted.
- `pending` records the latest attempt ID and start time. It can also mean a
  worker stopped before completing; a new attempt can supersede it.
- `succeeded` records the whole validated payload, source version, fetch time,
  and incremented revision in one transaction.
- `failed` records a safe error code and retryability, leaving the last good
  payload, revision, source version, and fetch time intact. Raw upstream error
  bodies and credentials are not stored in stream records.

The default call reuses an unexpired successful payload when its activity source version
still matches. `force: true` starts another fetch. Even a successful empty
payload is reusable. A fetch error is recorded and rethrown; an attempt that
has lost eligibility or been superseded returns `status: 'superseded'`.
Database errors propagate. An interrupted/failed database transaction can leave
the attempt pending, but cannot partially replace a successful payload.

Before beginning or committing, transactions lock user, account, activity,
then stream row, matching the erasure worker's user/account order. No lock is
held during network requests. The commit checks:

1. the activity is still owned by the actor and its Strava account is eligible;
2. the activity source version and credential generation still match;
3. the storage generation and latest attempt ID still match.

The source version hashes the relevant activity fields inside PostgreSQL.
A database trigger also rotates the storage generation on observed changes. The storage generation distinguishes activity deletion and
recreation, including recreation with the same ID. Commit only updates an
existing claimed row; it never upserts. A replay cannot increment revision,
and older requests cannot overwrite a newer attempt. Credential refresh uses
the same guard so an in-flight refresh cannot restore a revoked account.

## Follow-up boundary

- #185 adds iOS loading/cache. Charts and any downsampling remain deferred.

Follow [the migration deployment sequence](database-migrations.md) before
enabling a production consumer.

## Verification

`pnpm test` covers runtime validation, large string IDs, one multi-key request,
rate-limit propagation, and guarded token refresh behavior. With the guarded
local `*_test` database variables described in the migration guide,
`pnpm db:test-activity-streams` exercises actual PostgreSQL transactions:
exact six-stream round trips, partial/empty successes, cached reuse, failures
preserving the last payload, rollback after a database exception, cross-user
access, concurrent attempts, source changes during fetch, credential changes,
revocation, delete/recreate and user erasure. CI runs this proof after migrations.

## API and lifecycle (#183)

`GET /api/v1/activities/{id}/streams` accepts the standard cookie or ActivityMap
bearer credential and applies the shared per-session, per-user and IP limits.
Responses use the v1 envelope and `private, no-store`. Activity IDs stay decimal
strings. Missing, other-athlete, disconnected and revoked resources all return
404 without revealing stream availability.

The default `fetch=auto` synchronously fetches a missing or stale set. A shared
90-second database lease deduplicates requests across workers; overlapping
callers receive 202 and `Retry-After: 3`. The upstream operations share a
20-second abort deadline, including token refresh. There are no automatic
upstream retries. Expired leases can be reclaimed by a later caller.
`fetch=none` returns the current local state without a Strava request.
`refresh=true` requests a refresh, at most once a minute for a successful set;
it cannot be combined with `fetch=none`. Failed attempts have a one-minute
cooldown. The historical worker is never a prerequisite for on-demand loading.

The response has `activity_id`, `metadata`, `requested_types`, `streams`,
`last_error` and `next_retry_at`. Metadata contains storage generation, string
revision, `state` (`not_fetched`, `current`, `stale`), `fetch_status`, available
stream types, fetch time and expiry time. Freshness and attempt status are
separate: a failed refresh can leave a still-current last-good payload.

- A never-attempted set has `not_fetched`, revision `0`, and null samples.
- A successful empty set has `current`, `succeeded`, no available types and
  `{}` samples. A missing key in a _current_ set means an unavailable sensor.
- An invalidated/expired set has `stale`; samples are withheld from the API
  but retained in storage until replaced or erased.
- A failed upstream request uses the error envelope (429 for throttling, 503
  for upstream failure). `fetch=none` exposes its persisted status and safe
  error code. Unexpected database/internal errors use 500. Failures never
  manufacture a successful empty set.

Activity DTOs gain one optional `streams` metadata object. List, bootstrap and
change-feed hydration select only small metadata; `available_types` is stored
separately so these reads do not inspect or transfer sample JSON. Old Swift
clients ignore the additive field; new ones accept responses that omit it.
The new raw DTOs retain typed arrays and known per-stream metadata, while Swift
continues to ignore unknown future metadata fields.

Database triggers enforce publication and invalidation across every activity
writer. Inserting/updating stream state writes an activity upsert to
`sync_change` in the same transaction. A publication failure rolls back the
stream write. Changes to geometry, timing, distance, elevation, privacy or
sensor summary fields rotate the stream generation and cancel any claim.
Name/engagement-only changes preserve it. Explicit update webhooks also
invalidate after the detail upsert, even when the changed samples are invisible
in summary/detail scalar fields. Invalidation is idempotent until a new attempt.

The source projection is shared by the activity trigger and conditional stream
save. Every fetch still rechecks ownership, account eligibility, credentials,
source version and claim identity; token refresh and each upstream request also
check that the claim is current. Activity deletion cascades streams, and the
existing activity tombstone is the instruction to delete the entire client
stream cache. Deauthorization denies access immediately; erasure cascades the
stored payloads. No independent stream tombstones or bulk feed samples exist.

A successful fetch, including an empty success, expires after seven days.
Summary reconciliation never extends that deadline: summaries cannot prove
unchanged sensor samples. Known edits publish invalidation immediately;
otherwise clients must honor `expires_at` locally and request revalidation when
they next need streams. The expiry itself needs no scheduled feed mutation.
Generation plus revision identify a client cache entry; a generation change
invalidates old data even when the successful revision has not changed.

### Shared Strava request budget

Every `StravaClient` HTTP operation now reserves capacity in a common
PostgreSQL budget, across foreground calls, legacy sync, reconciliation and
webhooks. The four windows track overall/non-upload limits for 15 minutes and
one day, following [Strava's rate-limit specification](https://developers.strava.com/docs/rate-limits/).
Limits start conservatively at the documented defaults and are updated from
response headers. Reservation is atomic under a short advisory transaction
lock; no database lock spans a network request. Header reconciliation includes
outstanding reservations, retains the maximum usage and ignores late responses
for previous windows. Network failures remain charged. A 429 blocks the affected
window; absent headers close the current 15-minute window conservatively.

The budget keeps the existing reconciliation reserves of 25 requests per
15-minute window and 100 per day. All currently supported operations are
non-upload calls; OAuth refresh is conservatively charged against both limits.
The budget stores only four rows and rolls them forward at UTC boundaries.
The historical backfill uses this same accounting with the additional reserves
and batch limits below.

### Deployment and validation

Migrations 0011–0013 add lease/freshness/budget metadata, lifecycle triggers and
the small availability projection. Existing #182 payloads are retained and
marked stale once when switching source-version schemes. Apply these additive
migrations before deploying the endpoint **or the changed shared Strava client**;
the client now requires the budget table. Preview follows the existing migration
runner; Production follows the approval/order documented in the migration guide.

`pnpm db:test-stream-lifecycle` proves endpoint ownership for both auth modes,
deduplication, exact samples, array-free list/feed metadata, replay, seven-day
expiry, known and explicit invalidation, late saves, publication rollback,
empty success, throttling, deauthorization, deletion and shared budget races.
`bash scripts/verify-stream-dtos.sh <base-ref>` compiles both the new DTOs and
the actual previous generated Swift file, then decodes new/old activity payloads
and raw stream arrays. CI runs the PostgreSQL proof and Swift decoding check.

## Historical backfill (#184)

`POST /api/cron/backfill-activity-streams` is a separate invocation after summary
reconciliation, so each worker retains its own 45-second work budget within a
60-second route. The new endpoint requires the existing `x-cron-secret`,
`VERCEL_ENV=production`, `ACTIVITYMAP_EXTERNAL_EFFECTS=enabled`, and
`ACTIVITYMAP_STREAM_BACKFILL=enabled`. It is disabled by default. The workflow
also requires the GitHub repository variable `ACTIVITYMAP_STREAM_BACKFILL=enabled`.
A failed reconciliation step skips backfill for that hour.

Defaults are **5 activities and 10 outbound request reservations globally per
UTC hour**, sequentially. JSON parameters `activityLimit` (1–10) and
`requestLimit` (1–20) can lower or modestly raise the caps; the first invocation
sets the hour's allowance, and replays can only lower it. OAuth refresh counts
as a request, as does any retry. There are no in-run automatic retries.
Reservations are charged before outbound work and are not refunded on crashes,
so reported `requests` can exceed the actual requests sent. The shared Strava
budget additionally preserves **50 requests per 15 minutes and 200 per day** in
both overall and read windows; ordinary callers retain their 25/100 reserves.
The larger background reserve does not mark otherwise usable foreground
capacity blocked. Low quota or any 429 stops the run and pauses same-hour
replays. Upstream headers and shared accounting may keep later hours paused too.

The run's 90-second lease serializes overlapping workers. Hourly selected/request
counters are durable even if the process terminates. Per-activity scheduling
leases and the existing stream-fetch lease recover after 90 seconds. Every
upstream request rechecks the run lease and deadline, as well as stream ownership
and generation. HTTP cancellation uses the smaller of the remaining run deadline
and the ingestion service's 20-second timeout. Late responses cannot publish
past the work deadline or revive deleted/revoked/invalidated streams. Database
checkpoint/cleanup work has the remaining route time; the 45-second bound is a
work deadline, not a guarantee of a response during a database outage.

Three additive tables in migration 0014 hold the hourly allowance, account
rotation, and per-activity attempt metadata; migration 0015 adds the account
credential block described below. Scheduling writes do not publish
activity change-feed entries. Accounts rotate in order of last selection; each
account starts with its newest activity, then alternates oldest/newest. Thus
continuously arriving recent activities cannot permanently starve older history.
Only activities belonging to a connected, non-revoked account are eligible.
Current stream leases and cooldowns are respected, including foreground work.

A successful set, including `{}` or absent HR/power/GPS keys, completes historical
backfill for that storage generation. The worker does **not** periodically
refresh completed history merely because the API's seven-day cache expires;
on-demand loading still revalidates expired data. Known stream invalidation
makes an activity eligible again. This keeps completed recent activities from
consuming all capacity intended for unfetched history.

Attempts persist their count, generation, retry time and safe error code. Retryable
failures use exponential backoff starting at one hour and capped at 24 hours.
They remain retryable, including repeated quota deferrals. Not-found, invalid
payloads and other non-retryable errors are terminal for that generation.
Stopping at the run's own request cap, deadline or lease is not a failure: the
interrupted activity is released without an error or backoff and the stream
record is left untouched until its fetch lease expires.

Unauthorized responses describe the credentials, not the activity. They pause
the whole account by recording a non-secret fingerprint of its stored grant
(expiry and update timestamps) in `stream_backfill_account.blocked_credentials`;
no further requests are spent on that account until a token refresh or
reconnect changes the fingerprint. The activity keeps `unauthorized` as its
last error but is neither terminal nor backed off.
They stay visible in `stream_backfill_attempt` and are excluded from the automatic
queue. A new generation resets scheduling, while foreground fetches remain
independent of backfill retry policy. An operator can explicitly retry a corrected
terminal case by clearing `terminal` and `next_attempt_at` for that activity;
this does not reset shared request counters or bypass ownership checks.

The response and redacted cycle-complete log report `selected`, `fetched`,
`unavailable` (successful empty sets or activity/claim unavailable), `retried`,
`failed`, `requests`, `remainingBacklog`, `stopReason`, and `elapsedMs` for that
invocation. Backlog includes temporarily leased/cooling-down work but excludes
terminal failures and completed generations. A `complete` stop means no work is
currently eligible, so backlog can remain nonzero. `busy`, `activity_limit`,
`request_limit`, `deadline`, `rate_limit` and `lease_lost` explain other stops.
Failures of individual activities are recorded in a successful run response;
uncaught worker/storage errors fail the invocation. Inspect terminal failures alongside
the backlog when measuring coverage:

```sql
SELECT terminal, last_error->>'code' AS error_code, count(*)
FROM stream_backfill_attempt
GROUP BY terminal, last_error->>'code';
```

### Rollout, manual invocation, and pause

1. Deploy #182/#183 lifecycle handling and migrations 0010–0013 first. Verify
   invalidation, deletion and deauthorization before scheduled stream ingestion.
2. Apply additive migrations 0014–0015 and deploy this worker with both enable switches
   unset. Existing raw data needs no transformation or backfill migration.
3. Set the production server enable switch, then invoke a **one-activity** canary
   with the existing cron secret. Check counters, stored raw samples, and the
   owned API/change-feed metadata. A canary fixes that hour's smaller allowance.
4. Set the GitHub repository variable to enable the hourly step at the next hour.
   Observe actual fetched counts, backlog, terminal errors, quota stops, and
   ordinary Strava traffic. At five/hour, 120/day is only a theoretical ceiling.
5. Unset the GitHub variable to pause scheduling. Unset the server environment
   switch and redeploy to disable manual invocations too. Already-running work
   remains bounded by its deadline; do not delete progress rows to pause.

```sh
curl --fail-with-body --silent --show-error --max-time 60 \
  --request POST \
  --header "x-cron-secret: ${CRON_SECRET}" \
  --header 'content-type: application/json' \
  --data '{"activityLimit":1,"requestLimit":2}' \
  https://activitymap.dominik.page/api/cron/backfill-activity-streams
```

`pnpm db:test-stream-backfill` uses a guarded local test database and mocked
upstream HTTP with the real client and repositories. It proves multi-account
caps and fairness, OAuth accounting, overlapping and interrupted runs, replay
fencing, empty completion, all four quota windows and foreground headroom,
429/checkpoint preservation, retry/terminal handling, generation invalidation,
deauthorization/deletion, and both simulated and real abort deadlines. CI runs
it after migrations and the existing lifecycle proof. No live Strava calls are
made by the fixture.
