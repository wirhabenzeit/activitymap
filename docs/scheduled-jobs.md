# Scheduled jobs

ActivityMap's background work runs through authenticated `POST /api/cron/*`
routes on the production deployment. Each route checks the `x-cron-secret`
header against `CRON_SECRET` and enforces its own leases, hourly caps and pause
switches.

## Scheduler: Cloudflare Worker

GitHub Actions schedules proved unreliable. Between 26 September and
5 October 2026, every schedule ran only about five times a day: the
five-minute webhook drain had a median gap of 4.3 hours between runs, and the
hourly jobs gaps of up to 9.7 hours. Vercel's Hobby plan only allows daily
cron jobs. The `activitymap-cron` Worker in `cloudflare/cron` therefore
starts one batch on the hour (`0 * * * *`, UTC), so Postgres can suspend
between batches. The Worker calls these jobs in order:

1. `drain-webhook-inbox`
2. `cleanup-rate-limits`
3. `erase-revoked-athletes`
4. `reconcile-strava-summaries`
5. `backfill-activity-streams` (only if reconciliation succeeded)
6. `backfill-activity-photos`
7. `sync-activities` (up to 30 detail refreshes and 30 older activities)
8. `match-activity-places`

A second trigger (`*/10 * * * *`) calls `mirror-convex-shadow` every ten
minutes. It is off unless `ACTIVITYMAP_CONVEX_SHADOW_OWNERS` is set; see
`backend/README.md`.

Incoming Strava webhooks still get an immediate processing attempt. The hourly
drain handles pending events and retries that are due.

Place matching runs over up to 500 stale activities per hour, with a
40-second work deadline and a recoverable two-minute lease. A bounded metadata
pool of 2,000 candidates lets each group choose nearby activities while starting
in freshness order. It uses only stored streams, loads nearby places once per
bounded group of activities and makes no Strava requests. Groups fill to 25
where memory budgets allow and can grow to 500 when route centres stay within
25 km of the seed. Each group stops growing at
100,000 GPS samples or 1,000 sections (one activity can cross those targets).
Stored GPS is read in bounded batches; computed checks and sync events are saved
with bulk inserts in one transaction per group. Job metrics report input/commit
batch counts and milliseconds spent reading inputs, loading places,
matching/preparing tracks and committing results, so database overhead can be
distinguished from local computation.
An indexed pending-work table tracks stream changes, failures awaiting retry,
manual check resets and reconnections. Catalogue/recipe changes seed a catch-up
once; settled runs do not scan/hash every activity. The existing source,
authorization, catalogue and lease checks still guard each pending item.
Queue acknowledgements commit atomically with checks and sync events, so a
crashed or failed write leaves the work pending. The manual **Run encounter
matching** GitHub workflow runs one bounded cycle from reviewed `main`; it adds
no recurring schedule and keeps credentials in the existing Actions secret.
See [matching versions and invalidation](on-demand-places.md#persistent-checks-versions-and-invalidation).

Each hour, stream backfill handles up to 40 activities (60 Strava requests)
and photo catch-up up to 20 activities (48 requests). With Strava's 3,000
daily reads, that leaves room for details, reconciliation and interactive use.
The first stream call in an hour sets that hour's allowance and later calls can
only lower it, so every scheduler must request the same 40/60.

`cloudflare/cron/src/jobs.ts` defines the jobs and their request bodies.
`wrangler.jsonc` defines the triggers, and a test keeps the two in step. A
failed job doesn't stop later jobs, but it marks the invocation as failed in
Cloudflare's cron history. Each job's status and response are logged in
Workers Logs.

### Deploying

```sh
pnpm dlx wrangler@4 login
pnpm dlx wrangler@4 secret put CRON_SECRET --config cloudflare/cron/wrangler.jsonc
pnpm cron:deploy
```

`CRON_SECRET` must match the production deployment's value. The Worker has
no public URL (`workers_dev` and preview URLs are off). Pause a backfill with
its server-side switch (`ACTIVITYMAP_STREAM_BACKFILL=disabled`,
`ACTIVITYMAP_PHOTO_BACKFILL=disabled`); pause everything by disabling the
Worker's triggers in the Cloudflare dashboard.

## Admin dashboard

`/admin` shows each job's health (late after 2.5 missed intervals), the run
history from `scheduled_job_log` (14 days, pruned by `cleanup-rate-limits`),
the webhook inbox, per-athlete import coverage and the Strava request budget.
Every cron route appends one row per run through `withJobLog`; writing it
never fails the job. Access requires a Strava sign-in whose athlete id is
listed in `ACTIVITYMAP_ADMIN_ATHLETE_IDS`; anyone else gets a 404.

The ingestion table shows per-athlete counts, percentages, scheduling and
outstanding detail/stream/photo work. Place matching has a dedicated summary
and per-athlete coverage: checked (including zero encounters), queued, retry
waiting, outstanding failures and waiting for streams. Limited checks include
partial, uncovered and missing-GPS results. Only checks matching the current
recipe, catalogue and stream identity count as checked; revoked or disconnected
accounts are excluded from matching totals. The latest matching run shows saved
activities, throughput, batch counts and input/place/matching/commit timings.
Absent metrics on older runs are shown as unavailable. Refresh reads a new
snapshot without fetching from Strava or starting matching work.

The admin page has an explicit 60-second function limit for cold-start/network
headroom. Coverage materializes source/version facts once per activity before
aggregating; repeating the source hash per count made the query alone exceed
the previous 10-second default. On the same 4,602-activity local snapshot, the
query fell from 10.33 s to 1.46 s with identical counts, and the complete
dashboard data load took 1.75 s. These are local measurements. Production logs
record total, initial-read and ingestion-read milliseconds plus account count.
Reproduce the full data-loading path with `pnpm benchmark:admin-dashboard` on a
local snapshot; it requires at least 1,000 activities by default (override
`--min-activities`) and refuses remote databases. This exercises real reads;
rendering a page with synthetic data alone does not validate query performance.

An activity failure does not fail the whole run: `completed` means the job
finished, while `failed` counts its individual activity failures. Detail and
stream retries back off from one hour to at most 24 hours. A stream run can
report `complete` with a remaining backlog when accounts are blocked or
activities are waiting for retry; it means no more activities were eligible
for this run.

For stream authorization errors, a stored unexpired token gets one guarded
refresh and one retry. A repeated credential rejection pauses that account
until its credentials change. Missing activity read permission (including
Strava's `AccessToken.activity:read_permission.missing` 401) and activity-level
403s back off only the affected activity. The job's failure detail retains
recognized permission/token identifiers to help distinguish these cases.
