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
| Resume place re-match walks    | 24 hours |

The last restarts the re-match walk of a place catalogue publication that
still has changed tiles left (`maintenance.resumeRematchWalks`); a walk
removes each tile once it has finished it.

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

## TestFlight crash reports

At the end of the same hourly run, the Worker copies the crash reports
TestFlight testers shared from App Store Connect into the
`activitymap-testflight` D1 database (`cloudflare/cron/src/testflight.ts`).
Each report becomes one `crash_submissions` row
(`cloudflare/cron/migrations/`). A row holds the tester's comment, device, OS,
build number, every attribute Apple returned as JSON and the full crash log,
plus `exception_type` and `crashed_frame` parsed from the log for grouping.

The logs the API returns symbolicate system and framework frames, but not the
app's own: those read `ActivityMap 0x102934000 + 5349280` (load address +
offset). `crashed_frame` is therefore the first symbolicated frame of the
crashed thread, or else the first app frame as `ActivityMap +<offset>`, which
groups only within one build. Xcode's Organizer (Window → Organizer →
Crashes) shows the same crashes fully symbolicated, since the upload sends
dSYMs to Apple.

To symbolicate a stored log yourself, use the dSYMs the TestFlight workflow
attaches to each release as `ActivityMap-<version>-<build>-dSYMs.zip`
(builds from before this was added have none). The load address is the
ActivityMap line under "Binary Images"; pass the frame addresses after it:

```sh
gh release download ios/v1.0.0-beta.24 --pattern '*-dSYMs.zip'
unzip ActivityMap-*-dSYMs.zip
atos -arch arm64 -o dSYMs/ActivityMap.app.dSYM/Contents/Resources/DWARF/ActivityMap \
  -l 0x102934000 0x102e4dfa0 0x102e3b4b0
```

A run lists reports newest first and stops at the first one it already has;
the first run reads up to 1,000. It then downloads up to 25 missing crash logs,
retrying a failed download on up to five runs (`crash_log_error` says why).
A failed listing, e.g. a revoked key, marks the invocation as failed. The job
is skipped while the App Store Connect secrets are unset.

### Setting up

The key is the TestFlight workflow's App Store Connect API key (the same three
`APP_STORE_CONNECT_*` values as its GitHub secrets; the private key is the
`.p8` file's PEM text).

```sh
pnpm dlx wrangler@4 d1 migrations apply activitymap-testflight --remote --config cloudflare/cron/wrangler.jsonc
pnpm dlx wrangler@4 secret put APP_STORE_CONNECT_KEY_ID --config cloudflare/cron/wrangler.jsonc
pnpm dlx wrangler@4 secret put APP_STORE_CONNECT_ISSUER_ID --config cloudflare/cron/wrangler.jsonc
pnpm dlx wrangler@4 secret put APP_STORE_CONNECT_PRIVATE_KEY --config cloudflare/cron/wrangler.jsonc < AuthKey_XXXX.p8
pnpm cron:deploy
```

### Analysing

Query with D1's SQL console in the Cloudflare dashboard, or from here:

```sh
pnpm dlx wrangler@4 d1 execute activitymap-testflight --remote --config cloudflare/cron/wrangler.jsonc --command \
  "SELECT exception_type, crashed_frame, COUNT(*) AS reports, MAX(build_number) AS latest_build
   FROM crash_submissions GROUP BY 1, 2 ORDER BY reports DESC"
```

`d1 export activitymap-testflight --remote --output crashes.sql` takes a full
copy for offline analysis. Rows hold testers' email addresses and comments, so
keep exports out of the repository.

## Admin page

`/admin` manages the Strava push subscription. Access requires a Strava
sign-in whose athlete ID is listed in `ACTIVITYMAP_ADMIN_ATHLETE_IDS`; anyone
else gets a 404. Ingestion is observed on the Convex dashboard.
