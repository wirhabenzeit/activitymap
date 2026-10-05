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

| Cron (UTC)    | Jobs, in order                                                     |
| ------------- | ------------------------------------------------------------------ |
| `*/5 * * * *` | `drain-webhook-inbox`                                              |
| `0 * * * *`   | `cleanup-rate-limits`                                              |
| `17 * * * *`  | `erase-revoked-athletes`                                           |
| `37 * * * *`  | `reconcile-strava-summaries`, `backfill-activity-streams` (only if reconcile succeeded), `backfill-activity-photos` |

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
now, and `workflow_dispatch` for manual runs. `fetch.yml` (legacy
`sync-activities`) has no recorded runs and isn't part of the Worker.
