# Scheduled jobs

ActivityMap's background work runs through authenticated `POST /api/cron/*`
routes on the production deployment. Each route checks the `x-cron-secret`
header against `CRON_SECRET` and enforces its own leases, hourly caps and pause
switches, so calling a route twice, or from two schedulers, is safe.

## Scheduler: Cloudflare Worker

GitHub Actions schedules proved unreliable. Between 26 September and
5 October 2026, every schedule ran only about five times a day: the
five-minute webhook drain had a median gap of 4.3 hours between runs, and the
hourly jobs gaps of up to 9.7 hours. Vercel's Hobby plan only allows daily
cron jobs. The `activitymap-cron` Worker in `cloudflare/cron` therefore
triggers the routes on time:

| Cron (UTC)    | Jobs, in order                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `*/5 * * * *` | `drain-webhook-inbox`, `match-activity-places`                                                                      |
| `0 * * * *`   | `cleanup-rate-limits`                                                                                               |
| `17 * * * *`  | `erase-revoked-athletes`                                                                                            |
| `37 * * * *`  | `reconcile-strava-summaries`, `backfill-activity-streams` (only if reconcile succeeded), `backfill-activity-photos` |
| `47 * * * *`  | `sync-activities` (up to 30 detail refreshes and 30 older activities)                                               |

Place matching runs every five minutes over up to 500 stale activities, with a
40-second work deadline and a recoverable two-minute lease. A bounded metadata
pool of 2,000 candidates lets each group choose nearby activities while starting
in freshness order. It uses only stored streams, loads nearby places once per
bounded group of activities and makes no Strava requests. Groups fill to 25
where memory budgets allow and can grow to 500 when route centres stay within
25 km of the seed. Each group stops growing at
100,000 GPS samples or 1,000 sections (one activity can cross those targets).
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

## GitHub Actions

The workflows in `.github/workflows` keep their schedules as a fallback for
now, and `workflow_dispatch` for manual runs. `fetch.yml` triggers
`sync-activities` twice a day as a fallback for the Worker's hourly run.

## Admin dashboard

`/admin` shows each job's health (late after 2.5 missed intervals), the run
history from `scheduled_job_log` (14 days, pruned by `cleanup-rate-limits`),
the webhook inbox, per-athlete import coverage and the Strava request budget.
Every cron route appends one row per run through `withJobLog`; writing it
never fails the job. Access requires a Strava sign-in whose athlete id is
listed in `ACTIVITYMAP_ADMIN_ATHLETE_IDS`; anyone else gets a 404.

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
