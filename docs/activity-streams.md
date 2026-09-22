# Raw activity streams

Issue #182 adds an internal ingestion service. It requests `time`, `distance`,
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
Available types are derived from payload keys rather than stored redundantly.

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

The default call reuses a successful payload when its activity source version
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

The source version currently hashes the full activity row inside PostgreSQL.
This deliberately catches existing writers without requiring their integration
in #182. It is conservative: metadata-only activity updates can also invalidate
the cached result. The storage generation distinguishes activity deletion and
recreation, including recreation with the same ID. Commit only updates an
existing claimed row; it never upserts. A replay cannot increment revision,
and older requests cannot overwrite a newer attempt. Credential refresh uses
the same guard so an in-flight refresh cannot restore a revoked account.

## Follow-up boundary

- #183 adds the on-demand API, explicit lifecycle invalidation and sync metadata.
  It should refine the conservative source-version policy, decide how stale
  payloads are exposed, and include storage generation when constructing cache
  validators across delete/recreate. The repository's conditional commit is the
  persistence boundary; there is no endpoint yet.
- #184 adds resumable hourly backfill, request budgets and retry scheduling.
  Partial/empty successes must not be treated as an endless missing-data queue.
- #185 adds iOS loading/cache. Charts and any downsampling remain deferred.

The additive migration is safe before any consumer is enabled. Follow
[the migration deployment sequence](database-migrations.md) before wiring a
production consumer.

## Verification

`pnpm test` covers runtime validation, large string IDs, one multi-key request,
rate-limit propagation, and guarded token refresh behavior. With the guarded
local `*_test` database variables described in the migration guide,
`pnpm db:test-activity-streams` exercises actual PostgreSQL transactions:
exact six-stream round trips, partial/empty successes, cached reuse, failures
preserving the last payload, rollback after a database exception, cross-user
access, concurrent attempts, source changes during fetch, credential changes,
revocation, delete/recreate and user erasure. CI runs this proof after migrations.
