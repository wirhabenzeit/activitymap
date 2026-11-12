# Scheduled jobs

Most background work runs in the Convex backend, which schedules itself. The
app has one scheduled job of its own.

## In the Convex backend

Ingestion needs no scheduler: a job runs when a Strava event arrives or an
account's reconciliation sweep is due, and each sweep schedules the next
(`backend/README.md`, "Convex ingestion"). Maintenance runs as Convex cron
jobs (`backend/convex/crons.ts`):

| Job                            | Interval |
| ------------------------------ | -------- |
| Compact expired sync changes   | 24 hours |
| Expire bridge write nonces     | 1 hour   |
| Expire provider event receipts | 24 hours |
| Expire API rate limit windows  | 24 hours |

Their runs, failures and logs are on the deployment's Convex dashboard.

## In the app: account erasure

`POST /api/cron/erase-revoked-athletes` erases the accounts whose Strava access
was withdrawn more than 30 days ago: the library in Convex first, then the
sign-in records. An account that has reconnected is kept. The route checks the
`x-cron-secret` header against `CRON_SECRET` and does nothing unless
`ACTIVITYMAP_EXTERNAL_EFFECTS=enabled`.

The `activitymap-cron` Cloudflare Worker (`cloudflare/cron`) calls it on the
hour (`0 * * * *`, UTC). GitHub Actions schedules ran too irregularly and
Vercel's Hobby plan allows only daily cron jobs.
`cloudflare/cron/src/jobs.ts` defines the jobs and `wrangler.jsonc` the
trigger; a test keeps the two in step. Each run's status and response are in
Workers Logs, and a failed job marks the invocation as failed in Cloudflare's
cron history.

### Deploying

```sh
pnpm dlx wrangler@4 login
pnpm dlx wrangler@4 secret put CRON_SECRET --config cloudflare/cron/wrangler.jsonc
pnpm cron:deploy
```

`CRON_SECRET` must match the production deployment's value. The Worker has
no public URL (`workers_dev` and preview URLs are off). Pause it by disabling
its trigger in the Cloudflare dashboard.

## Admin page

`/admin` manages the Strava push subscription. Access requires a Strava
sign-in whose athlete ID is listed in `ACTIVITYMAP_ADMIN_ATHLETE_IDS`; anyone
else gets a 404. Ingestion is observed on the Convex dashboard.
