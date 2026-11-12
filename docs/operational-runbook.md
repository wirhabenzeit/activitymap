# Operational runbook

Use production logs and the production Convex deployment only through
approved access.
Do not paste credentials, webhook payloads, or personal data into tickets.

## API failures

Ask for the response `X-Request-Id` and search structured logs for that ID.
The `/api/v1` completion line includes route, method, status, and duration.

For `429 rate_limited`, honor `Retry-After`. Investigate only if normal client
traffic is being limited repeatedly or failures affect many users.

## Webhook events

A Strava activity event is recorded in Convex (`providerEvents`) before Strava
is answered. If Convex cannot take it, the webhook answers with an error and
Strava delivers the event again. Each recorded event queues an ingestion job
for its activity.

Look for `[Webhook]` errors in the production logs. Missed or lost events are
picked up by the account's reconciliation sweep, which re-reads the activity
list from Strava every six days.

## Failed ingestion

Ingestion jobs (`ingestionJobs` in Convex, one per account and activity) run
in phases: the activity, its recording, its place matches. Look for jobs with
status `failed` or `blocked` and their `error` on the Convex dashboard. A
failed job is retried by the account's next sweep, which requests every
activity that is still incomplete. To retry sooner, start the sweep: the
account's owner can use **Fetch from Strava** in Settings, or an operator can
send the write bridge's `sweepNow` operation for the account.

A `blocked` job waits for the account's Strava credentials to change, for
example after a reconnect.

## Credential revocation

The athlete-deauthorization webhook clears stored Strava tokens immediately,
marks the account revoked, and schedules its erasure 30 days later (sign-in
records in Convex, `~/server/strava/convex-webhook.ts`). The hourly `erase-revoked-athletes` job
deletes due data after 30 days. See [Strava data policy](strava-data-policy.md)
for the policy.

If revocation appears stuck, check the records in this order.

1. Check the production logs for the athlete webhook.
2. Confirm the account's revocation and erasure times are set and its tokens
   are empty.
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
for a recent retention/configuration change, backend restore, stale cursor
reuse, or a server regression.
