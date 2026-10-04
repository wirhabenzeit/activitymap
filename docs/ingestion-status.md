# Ingestion status

How ActivityMap records and reports what it has imported from Strava for an
account (issues #296 and #297). The web and iOS settings screens (#300, #301)
present this. Later recovery actions (#298) will extend it.

The status covers **Strava → ActivityMap** only. Whether a browser or device
has downloaded ActivityMap's data is separate local sync state, and a complete
local sync never makes the server status complete.

## Categories

| Category | Population | Source of truth | Automatic work |
| --- | --- | --- | --- |
| History | Activity summaries | `user.last_summary_reconciled_at` and `strava_summary_reconciliation` | Hourly summary reconciliation, a full rescan every 6 days |
| Details | Every stored activity | `activities.geometry_state` | Legacy sync job, twice daily |
| Photos | Activities Strava reports as having photos | `activities.photos_state` | None. Photos are refreshed only for the most recent activity, by webhooks and by explicit refreshes |
| Streams | Every stored activity | `activity_streams` and `stream_backfill_attempt` | Hourly stream backfill, if enabled |

Derived chart summaries are computed from fetched streams. They are reported as
an overlapping count within streams, not as a separate import.

### History

Discovery is `complete` only after one full Strava summary scan has reached an
empty page and confirmed every stored activity it did not see. The legacy
`oldest_activity_reached` flag is not used. It only records that one page
returned fewer than two activities, which does not prove that every gap is
filled.

Before discovery completes, `totalActivityCount` is `null`. The number of
activities on Strava is unknown, so clients must not show a percentage or a
time estimate. `reconciliation.freshness` reports the Strava seven-day
revalidation rule (docs/strava-data-policy.md): `current` up to 6 days after
the last completed scan, `due` until 7 days, then `overdue`.

### Details

One rule decides whether an activity still needs details: `geometry_state` is
not `detailed`. The enrichment worker
(`detailEnrichmentPending` in `src/server/repositories/ingestion.ts`) and the
status read model both use it. Two kinds of activity count as pending:

- `neverFetched`: only the summary has been stored.
- `invalidated`: summary reconciliation saw the route change after its details
  were fetched.

An activity whose details have been fetched is complete even when it has no
GPS route, sensors or photos. Missing data is a valid result, not pending work.

When fetching details for one activity fails, the activity backs off in
`activity_detail_attempt`: 1 hour, then doubling, capped at 24 hours. This
keeps one failing activity from starving the rest. Rate limits and rejected
credentials never back off an individual activity. They stop the run, which is
recorded as `deferred` or `blocked`.

### Streams

Every activity falls into exactly one of these:

- `withData` / `withoutData`: fetched and current. `withoutData` covers manual
  activities and activities without sensors, and is complete.
- `runnable`: eligible for the next backfill run.
- `waiting`: an on-demand retry, a backfill backoff or a lease ends at
  `retryAt`.
- `blocked`: Strava rejected the account's current credentials, or the account
  is disconnected.
- `failed`: backfill gave up permanently on this stream generation.

Stream freshness does not expire with age. A completed historical fetch is not
requeued just because time has passed, so `withData` means "fetched for the
current route", not "fetched recently".

## Progress, scheduling and outcome are separate

Each category reports these three independently. Clients compose the headline
from them. They must not be merged into one state.

- **`progress`**: `not_started`, `in_progress`, `complete` or `unknown`.
- **`scheduling`**: whether automatic work will continue:
  - `idle`: nothing is outstanding.
  - `scheduled`: the job is running normally.
  - `waiting`: everything outstanding is backing off until `retryAt`.
  - `blocked`: the account needs reconnecting (`schedulingReason`).
  - `disabled`: the job is switched off on the server.
  - `stalled`: the job has stopped reporting.
  - `not_scheduled`: no automatic job covers this work (stale photos).
  - `unknown`: the job has never reported.
- **`lastOutcome`** (history and details): how the last run for this account
  ended:
  - `succeeded`: committed without failure, even if more work remains.
  - `partial`: some items committed and some failed.
  - `deferred`: stopped early because of the rate limit or the time budget.
  - `failed`: no progress was possible.
  - `blocked`: the credentials were rejected or are unavailable.

  It also carries a safe `reason`, `attemptedAt` and `lastSucceededAt`.
  `lastSucceededAt` only advances when a run ends with no failure at all.

A `blocked` outcome stops applying as soon as the account's grant changes, for
example after a reconnect, even before the next run reports.

## Scheduler observation

Three things gate the scheduled jobs:

- the GitHub workflow schedule
- repository variables, such as `ACTIVITYMAP_STREAM_BACKFILL`
- server environment switches

The server cannot observe the first two. Each cron route therefore records a
heartbeat in `background_job_run`: when the job started, when it finished,
whether it `completed`, `failed` or was `disabled`, and its own stop reason.

The status uses the heartbeats as follows:

- A job that never reported is `unknown`.
- A job whose last start is older than twice its interval plus 15 minutes, or
  that started and did not finish within 5 minutes, is `stalled`.
- The stream backfill server switch is read directly, so a server-side
  `disabled` is certain.

A recent heartbeat is not a promise that the next run will happen.

Heartbeats are global and expose no other account's data. The status endpoint
reports only their effect on the caller's scheduling.

## Endpoint

`GET /api/v1/ingestion-status`, with cookie or bearer authentication. It uses
the standard v1 envelope and the `IngestionStatus` schema in
`src/contracts/v1/ingestion-status.ts`.

- **Read-only:** it never calls Strava, fetches or generates streams, loads
  stream samples or media, or writes anything. It runs bounded aggregate
  queries over the caller's own activity rows.
- **Polling:** the response is `Cache-Control: private, max-age=60`. Clients
  should not poll faster, and should only poll while a settings screen is
  visible.
- **Snapshot age:** `observedAt` is when the server observed the status. A
  client showing an older response, for example while offline, presents it as
  the last known status and does not treat its `scheduling` as current.
- **Missing server or offline:** on an older server, a 404 means status is
  unavailable. Clients then show only their local sync state. Offline, they
  show the last response with its `observedAt`.
- **Compatibility:** fields are added according to
  docs/api-compatibility-and-deprecation.md. The generated Swift enums decode
  strictly, so new values for `progress`, `scheduling`, `outcome`, `reason` or
  `freshness` are breaking for older iOS builds. Add them only together with a
  client-side fallback, or as a new field.
- **Manual actions:** none are exposed yet. #298 will add operation
  capability and retry fields. Until then, clients must not imply that manual
  backfill exists.

## Shared fixtures

`shared/ingestion-status-fixtures.v1.json` lists named scenarios: partial
import, unknown history total, details waiting after failures, no-GPS
activities and activities without streams, photo-only staleness, rejected and
reconnected credentials, rate-limit waits, stalled and disabled schedulers, a
revoked account, and an expired snapshot.

Each scenario contains:

- `snapshot`: the server read model input.
- `status`: the exact response `data`.
- `clientExpectation`: what the user should be told.

`src/server/application/ingestion-status.test.ts` derives every `status` from
its `snapshot` and checks that the counts partition as documented. Client tests
in #300 and #301 should assert their presentation against the same `status`
values.

`pnpm db:test-ingestion-status` checks the eligibility rule, detail backoff,
outcomes, heartbeats and account isolation against PostgreSQL.

## Settings clients (#300 / #301)

Web Settings and the native Settings form show server history, details, streams
and photo metadata independently from browser/device downloads. The main
screen uses compact status rows; detailed counts and run explanations expand
on web and open native destinations on iOS. Web account, display and about
settings have separate tabs. The screens do not
infer server totals from locally loaded activities. Terminal stream failures
are labelled “Needs attention” even when the server has no runnable work.
The former web Repair/Photos/Clean table is no longer part of Settings.

Status requests run only while Settings is visible, at least 60 seconds apart,
with server Retry-After deadlines respected. Both clients retain the observation
time and label snapshots older than two minutes, or viewed offline, as last
known state. iOS persists only the typed snapshot and next-check deadline under
the existing deployment/account scope. Cancellation and account changes fence
late responses. A missing or incompatible endpoint leaves coverage unknown.

Browser download state comes from OfflineSyncProvider, including the last
successful persisted sync, safe failures, offline state and a bounded retry.
iOS continues to use SyncController and its authorized cache and recovery rules;
pausing/downloading explicitly affects this device only.

`shared/ingestion-client-expectations.v1.json` defines matching web/iOS wording
for all shared status fixtures. Node presentation tests and native
`IngestionStatusTests` compare every scenario; native tests also cover cache
scoping, late responses, rejected sessions and persisted retry deadlines.
`RenderedIngestionStatusTests` exercises phone, dark, large Dynamic Type and iPad
layouts with fixture data. Physical-device and manual VoiceOver certification
remain separate checks; these tests do not certify either.
