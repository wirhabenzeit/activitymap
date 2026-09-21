# Operational runbook

On-call procedures for the `/api/v1` native-client backend: diagnosing a
webhook processing backlog, handling dead-lettered webhook events, what
happens on athlete credential revocation, and what a forced rebootstrap
means and how to respond to one. This is a companion to
docs/strava-data-policy.md (the policy this system implements) and
docs/database-migrations.md (schema/deployment procedures); it does not
duplicate either, and links to them for the parts it doesn't repeat.

## Webhook processing backlog

Strava webhook deliveries land in the durable `strava_webhook_events`
inbox (issue #124) and are drained by a scheduled job rather than
processed inline on receipt (issue #125).

### How it runs

- `POST /api/cron/drain-webhook-inbox` (`src/app/api/cron/drain-webhook-inbox/route.ts`)
  runs every 5 minutes via `.github/workflows/drain-webhook-inbox.yml`
  (this repository has no `vercel.json`, so all scheduled work is a GitHub
  Actions workflow that `curl`s an `x-cron-secret`-protected route - see
  that workflow file for the exact request). Each run:
  1. Resets any row stuck in `processing` past a 10-minute stale-lock
     timeout (`STALE_PROCESSING_TIMEOUT_MS`,
     `src/server/strava/webhook-drain.ts`) back to retryable - recovery
     from a crashed worker.
  2. Claims and processes a bounded batch (`DEFAULT_DRAIN_BATCH_SIZE = 25`,
     `DEFAULT_DRAIN_CONCURRENCY = 5`) of due `pending`/`failed` rows.
     Deletion (`aspect_type: "delete"`) and athlete-deauthorization
     (`object_type: "athlete"`) events are prioritized ahead of routine
     create/update events.
  3. Logs backlog/dead-letter/sync-lag metrics as one structured line (see
     below) - this codebase has no metrics backend or dashboard; the
     structured logs *are* the metrics.

### Diagnosing a backlog

Look for the cron's own completion log line, `[Cron] drain-webhook-inbox
complete`, which includes the `metrics` object from
`getWebhookInboxMetrics()` (`src/server/strava/webhook-drain.ts`):

- `countsByStatus` - number of rows per status (`pending`, `processing`,
  `failed`, `succeeded`, `dead_letter`). A `pending`+`failed` count that
  keeps climbing across successive runs means the drain is falling behind
  arrival rate.
- `oldestPendingEventTime` / `oldestPendingAgeMs` - age of the single
  oldest still-outstanding event. This is the number that matters for the
  data policy's "reflect a deletion within 48 hours" requirement (see
  docs/strava-data-policy.md §2) - if it approaches that deadline, this is
  urgent, not just a queue-depth curiosity.

If the backlog is growing:

1. Check whether the cron is actually firing - look for recent
   `[Cron] drain-webhook-inbox complete`/`failed` log lines at all. A
   silent gap usually means the GitHub Actions schedule stopped (check the
   workflow run history) or `CRON_SECRET` drifted between the secret and
   the workflow.
2. Check `reconciled` in the same log line - a large, repeatedly non-zero
   value means workers are crashing mid-attempt (see the stale-lock
   recovery above) rather than a genuine throughput problem.
3. If genuinely falling behind Strava's delivery rate, the cron can be
   fired on demand outside its schedule (`fire_trigger` if it is wired to
   a Routine, or a direct authenticated `POST` to the route) with a larger
   `batchSize`/`concurrency` in the request body (both bounded, but
   overridable per call - see the route's handler for the exact shape).
   Prefer several smaller on-demand runs over one very large one, since a
   single run still shares this application's one Strava API rate limit
   budget with every other athlete's sync/reconciliation work.

## Dead-lettered webhook events

A webhook delivery is marked `dead_letter` (instead of retried again)
when `classifyWebhookError` (`src/server/strava/webhook-retry.ts`)
determines the failure is permanent (e.g. the local account no longer
exists), or when a retryable failure has already been attempted
`MAX_WEBHOOK_ATTEMPTS` (10) times with exponential backoff
(`INITIAL_BACKOFF_MS` 30s, capped at `MAX_BACKOFF_MS` 2h - a little over 4
hours of wall-clock retrying in the worst case, comfortably inside the
policy's 48-hour deletion-processing deadline).

A dead-lettered row is **not** deleted - it stays in
`strava_webhook_events` with `status = 'dead_letter'`, its full original
payload (`payload` column, the raw Strava webhook body), and `last_error`
recording what finally failed it. This is deliberate: a dead-lettered
event usually means something needs a person's attention, not silent data
loss.

### Inspecting dead-lettered events

`WebhookEventsRepository.listByStatus('dead_letter')`
(`src/server/repositories/webhook-events.ts`) is the supported read path -
most recently updated first. There is no admin UI for this; the most
direct way to inspect one:

```sql
select id, object_type, aspect_type, owner_id, event_time,
       attempt_count, last_error, payload
from strava_webhook_events
where status = 'dead_letter'
order by updated_at desc
limit 50;
```

Read `last_error` first - it usually tells you immediately which bucket
you're in:

- **The account no longer exists locally** (a `UserNotFoundError` - this
  is `classifyWebhookError`'s one built-in "permanent" case besides an
  explicit `PermanentWebhookError`). Usually expected and not actionable -
  e.g. a webhook for an athlete who was already fully erased (see
  "Credential revocation" below). Leave it dead-lettered; do not requeue.
- **A genuinely transient failure that outlasted the retry budget**
  (a prolonged Strava outage, a sustained database issue during the retry
  window). This is the case worth requeuing once the underlying issue is
  confirmed resolved.
- **A structurally-unsupported or malformed delivery.** Investigate the
  `payload` before requeuing - retrying an event this application does not
  know how to process will just fail again identically.

### Manually requeuing a dead-lettered event

Only do this once you've established the underlying cause is resolved (see
above). Resetting a row back to retryable and due immediately:

```sql
update strava_webhook_events
set status = 'pending', attempt_count = 0, next_attempt_at = now()
where id = '<event id>' and status = 'dead_letter';
```

The next drain cycle will pick it up through the same `claim` path as any
other due row (`WebhookEventsRepository.claim`), so it gets the normal
priority ordering and the normal backoff/dead-letter treatment if it fails
again. There is no bulk "requeue all dead-letter rows" tool on purpose -
each one should be looked at, since a dead-lettered row already burned its
retry budget once, and blindly mass-requeuing a bad delivery just repeats
the same failure `MAX_WEBHOOK_ATTEMPTS` more times.

## Credential revocation (athlete deauthorization)

Full design and policy rationale: docs/strava-data-policy.md §3. Summary
for on-call purposes:

1. Strava delivers an `object_type: "athlete"` webhook when an athlete
   revokes ActivityMap's access (or Strava otherwise invalidates it).
   `handleAthleteDeauthorization` (`src/server/strava/webhook.ts`)
   processes it transactionally and idempotently: it clears both sets of
   stored token columns, sets `accounts.revokedAt`, and sets
   `accounts.scheduledErasureAt` to 30 days out - all in the same
   transaction, so a live token and a `revokedAt` timestamp can never
   coexist.
2. From that moment, this application must never attempt another refresh
   or API call with that account's (now-cleared) tokens. This is enforced
   at multiple points, not just by the tokens being gone:
   `summary-reconciliation`'s candidate query and claim both check
   `revokedAt` is null before ever resolving an access token
   (`src/server/repositories/summary-reconciliation.ts`), and the legacy
   `syncActivities` cron excludes revoked accounts from its user query
   entirely (issue #127 hardening, `src/server/strava/sync.ts`).
3. `POST /api/cron/erase-revoked-athletes` runs hourly
   (`.github/workflows/erase-revoked-athletes.yml`) and completes the
   30-day deletion once `scheduledErasureAt` is due: it rechecks each
   candidate under a row lock (cancelling erasure if the athlete
   reconnected with a fresh credential in the meantime - see
   `getAccountInternal`'s reconnect-clears-revocation logic in
   `src/server/db/internal.ts`), and otherwise deletes the athlete's
   Strava-derived identity, activities, photos, tokens, sessions, change
   feed, tombstones, webhook payloads, and mobile login codes in one
   transaction (`eraseDueRevokedAthletes`, `src/server/strava/erasure.ts`).

### On-call checklist for a revocation report

- Confirm the account shows `accounts.revokedAt` set and
  `scheduledErasureAt` roughly 30 days out. If neither is set but the
  athlete says they disconnected, check the webhook inbox
  (`strava_webhook_events` filtered by `object_type = 'athlete'` and that
  athlete's `owner_id`) for a delivery that may still be `pending`,
  `failed`, or `dead_letter` - see the sections above.
- Do **not** manually clear `revokedAt` to "fix" a support request unless
  the athlete has genuinely reconnected through a fresh Strava OAuth
  sign-in (which clears it automatically) - clearing it manually without a
  live, valid token would put the application back in the exact state
  #125 fixed (retrying a dead credential indefinitely).
- If an athlete disputes that they revoked access, that is a Strava-side
  fact this application only reflects, not one it can override - point
  them to reconnecting through Strava's own authorization flow.

## Forced rebootstrap (`409 sync_rebootstrap_required`)

Full design: issue #123 and docs/swiftui-backend-preparation-plan.md's
"Synchronization protocol". Summary for on-call purposes:

`GET /api/v1/sync/changes` returns `409` with error code
`sync_rebootstrap_required` (never a partial or best-effort result)
whenever the presented cursor cannot be trusted to resume from safely:

- it is malformed or from an unsupported cursor version;
- it was issued for a different athlete than the caller;
- it is older than the retained change-feed history
  (`DEFAULT_RETENTION_DAYS = 90`, `src/server/repositories/changes.ts`) -
  this is what "offline expiry" means for this API: a client that has not
  synced in over 90 days has no valid path to resume, since the
  intervening change history it would need may have been compacted;
- it points beyond the athlete's current change-feed high-water mark
  (should not happen in normal operation; would indicate either a bug or
  cross-environment data corruption, e.g. a cursor captured against a
  different database).

**This is an expected, routine client-side outcome, not an incident on its
own.** The documented client response is to call `GET
/api/v1/sync/bootstrap` again from scratch and re-populate its local
store, then resume `sync/changes` from the fresh `snapshotCursor` that
bootstrap's first page returns. No server-side action is needed for an
individual client hitting this.

It becomes worth investigating as an operator when:

- **The rate of `409`s spikes sharply across many clients at once** -
  check whether `DEFAULT_RETENTION_DAYS` or the change-feed compaction job
  changed recently (a shorter retention window than clients were relying
  on would surface exactly this way), or whether a database restore/branch
  switch replaced the change feed with an older one out from under
  already-issued cursors.
- **One athlete repeatedly hits it immediately after a successful
  bootstrap** - check for a clock skew issue (cursor `issuedAt` is server
  time; a request replayed through a stale cache or proxy could carry an
  already-expired timestamp), or a client-side bug re-sending a cursor
  from a previous, discarded local database.

Rebootstrapping is always correct and always safe to tell an affected user
to do (worst case, it re-downloads data the client already had); it should
never be treated as data loss on the server's part - the change feed
itself is unaffected, only that one client's resume point was invalid.
