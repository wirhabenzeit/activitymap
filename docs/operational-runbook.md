# Operational runbook

Use production logs and the production database only through approved access.
Do not paste credentials, webhook payloads, or personal data into tickets.

## API failures

Ask for the response `X-Request-Id` and search structured logs for that ID.
The `/api/v1` completion line includes route, method, status, and duration.

For `429 rate_limited`, honor `Retry-After`. Investigate only if normal client
traffic is being limited repeatedly or failures affect many users.

## Webhook backlog

Cloudflare runs `drain-webhook-inbox` once per hour. Incoming Strava webhooks
still get an immediate processing attempt.

1. Look for missing or failed runs in Cron Events for `activitymap-cron`.
2. Production logs for `[Cron] drain-webhook-inbox complete` or `failed`.
3. `metrics.countsByStatus` and `metrics.oldestPendingAgeMs`. Growing
   `pending`/`failed` counts mean the drain is falling behind. Deletion events
   approaching 48 hours are urgent.
4. Repeated non-zero `reconciled` counts, which indicate workers are becoming
   stuck or timing out.

After fixing the cause, confirm the next scheduled drain succeeds. For an
immediate retry, send an authenticated `POST /api/cron/drain-webhook-inbox`
with the cron secret. Use the defaults of 25 events and concurrency 5 while
Strava or the database is recovering.

## Summary reconciliation freshness

Cloudflare runs `reconcile-strava-summaries` hourly to keep cached Strava
data within the seven-day limit. The `overdue` count includes connected
athletes whose last complete scan is more than seven days old. For athletes
awaiting their first scan, it counts from sign-up. A non-zero value is logged as
`[Summary reconciliation] Athletes past the freshness limit`.

`overdue` should stay at zero. If it rises, check Workers Logs for recent
failures, `stoppedForRateLimit`, or `stoppedForTimeBudget`. Each run handles
one athlete with up to three pages of 200 summaries, so a steadily growing
count means the job no longer keeps up and needs a larger `batchSize`.

## Dead letters

Webhooks for athletes without an ActivityMap Strava account are acknowledged
with `200` and never stored. Strava sends them for anyone who authorised the
Strava app, including sign-ups on local or preview deployments and erased
athletes. A dead letter therefore always concerns a registered athlete.

Inspect recent rows without selecting `payload` unless it is necessary:

```sql
select id, object_type, aspect_type, owner_id, event_time,
       attempt_count, last_error, updated_at
from strava_webhook_events
where status = 'dead_letter'
order by updated_at desc
limit 50;
```

Do not requeue permanent failures such as a missing/erased local account. Once
a transient root cause is fixed, requeue one reviewed event:

```sql
update strava_webhook_events
set status = 'pending',
    attempt_count = 0,
    next_attempt_at = now(),
    updated_at = now()
where id = '<event id>'
  and status = 'dead_letter';
```

Confirm the next drain succeeds. Never bulk-requeue dead letters.

## Credential revocation

The athlete-deauthorization webhook clears stored Strava tokens immediately,
sets `account.revoked_at`, and schedules erasure in
`account.scheduled_erasure_at`. The hourly `erase-revoked-athletes` job
deletes due data after 30 days. See [Strava data policy](strava-data-policy.md)
for the policy.

If revocation appears stuck, check the records in this order.

1. Check the athlete webhook row and its status/error.
2. Confirm both revocation timestamps and that token columns are empty.
3. Check the erasure job in Workers Logs after the scheduled time.

Never clear revocation fields manually. A genuine reconnect through Strava
OAuth clears them safely.

## Forced sync rebootstrap

`409 sync_rebootstrap_required` means the cursor is invalid, belongs to another
athlete, is beyond the current feed, or is older than 90 days. For one client,
this is routine: clear its local sync state, call `/api/v1/sync/bootstrap`, then
resume changes from the returned `snapshotCursor`.

Investigate when many clients start receiving 409s together or one client gets
another 409 immediately after a successful bootstrap. Use request IDs to check
for a recent retention/configuration change, database restore, stale cursor
reuse, or a server regression.
