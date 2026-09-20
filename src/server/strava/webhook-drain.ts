import 'server-only';

import { db as defaultDb } from '~/server/db';
import { logger } from '~/server/logging/logger';
import { runWithConcurrencyLimit } from '~/server/util/concurrency';
import {
  createWebhookEventsRepository,
  type WebhookEventsRepository,
  type WebhookInboxBacklogMetrics,
} from '~/server/repositories/webhook-events';
import { sortByDrainPriority } from '~/server/strava/webhook-retry';
import { processWebhookEvent, type StravaWebhookEvent } from '~/server/strava/webhook';

type DrizzleDb = typeof defaultDb;

/**
 * Default batch size and concurrency for one drain cycle. Neither is
 * tuned against production load yet - they are conservative starting
 * points a future change can adjust from observed backlog/latency
 * metrics (see `getWebhookInboxMetrics`) without changing the drain's
 * shape.
 */
export const DEFAULT_DRAIN_BATCH_SIZE = 25;
export const DEFAULT_DRAIN_CONCURRENCY = 5;

/**
 * A worker that crashes mid-attempt leaves its row `processing` forever
 * without a reconciliation pass. This is comfortably longer than any
 * single webhook processing attempt (one Strava activity fetch plus one
 * DB transaction) should ever take, so a row still `processing` after
 * this long is treated as stuck rather than merely slow.
 */
export const STALE_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export type DrainResult = {
  /** Rows fetched as due candidates this cycle, before claiming. */
  candidates: number;
  /** Candidates this worker actually won the atomic claim for. */
  claimed: number;
  succeeded: number;
  /** Failed but still retryable - stays `failed` with a backed-off `nextAttemptAt`. */
  retrying: number;
  deadLettered: number;
  /** Candidates another concurrent drain run (or the route's best-effort attempt) claimed first. */
  lostRace: number;
};

export type DrainWebhookInboxOptions = {
  database?: DrizzleDb;
  batchSize?: number;
  concurrency?: number;
  now?: Date;
  repository?: WebhookEventsRepository;
  /** Injectable for tests; defaults to the real `processWebhookEvent`. */
  processEvent?: (payload: StravaWebhookEvent) => Promise<void>;
};

/**
 * Drains the Strava webhook inbox: fetches due `pending`/`failed` rows
 * (deletion/deauthorization events prioritized ahead of routine
 * create/update events - see `selectDrainCandidates`/`sortByDrainPriority`),
 * claims and processes a bounded number of them concurrently, and applies
 * retry/backoff/dead-lettering to whatever does not succeed. See issue
 * #125.
 *
 * Concurrent invocations (two overlapping cron runs, or a drain run
 * racing the route handler's best-effort `processInboxEvent` attempt for
 * a just-arrived row) cannot double-process the same row: each candidate
 * is claimed atomically via `WebhookEventsRepository.claim` immediately
 * before processing, and a lost race is counted in `lostRace` rather than
 * treated as an error.
 */
export async function drainWebhookInbox({
  database = defaultDb,
  batchSize = DEFAULT_DRAIN_BATCH_SIZE,
  concurrency = DEFAULT_DRAIN_CONCURRENCY,
  now = new Date(),
  repository = createWebhookEventsRepository(database),
  processEvent = (payload) => processWebhookEvent(payload, database),
}: DrainWebhookInboxOptions = {}): Promise<DrainResult> {
  const fetched = await repository.selectDrainCandidates(batchSize, now);
  // Re-sorted in application code, not just fetched in priority order:
  // with bounded concurrency the *dispatch* order determines which rows
  // actually start first in this cycle, not merely the fetch order.
  const candidates = sortByDrainPriority(fetched);

  const result: DrainResult = {
    candidates: candidates.length,
    claimed: 0,
    succeeded: 0,
    retrying: 0,
    deadLettered: 0,
    lostRace: 0,
  };

  await runWithConcurrencyLimit(candidates, concurrency, async (candidate) => {
    // `now` (the cycle's single logical timestamp, not a fresh `new
    // Date()` per row) is reused for claim/complete/fail so the whole
    // cycle reasons about one consistent point in time - and so a caller
    // that injects `now` for a test gets fully deterministic behavior.
    const claimed = await repository.claim(candidate.id, now);
    if (!claimed) {
      result.lostRace++;
      return;
    }
    result.claimed++;

    const startedAt = Date.now();
    try {
      await processEvent(claimed.payload);
      await repository.complete(claimed.id, now);
      result.succeeded++;
      logger.info('[WebhookDrain] event processed', {
        eventId: claimed.id,
        objectType: claimed.objectType,
        aspectType: claimed.aspectType,
        attemptCount: claimed.attemptCount + 1,
        processingMs: Date.now() - startedAt,
        // "Sync lag": how long between Strava's own event timestamp and
        // this event finishing processing here.
        syncLagMs: now.getTime() - claimed.eventTime.getTime(),
      });
    } catch (error) {
      const decision = await repository.fail(claimed.id, claimed.attemptCount, error, now);
      if (decision.status === 'dead_letter') result.deadLettered++;
      else result.retrying++;
      logger.error('[WebhookDrain] event failed', {
        eventId: claimed.id,
        objectType: claimed.objectType,
        aspectType: claimed.aspectType,
        attemptCount: decision.attemptCount,
        status: decision.status,
        nextAttemptAt: decision.nextAttemptAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  logger.info('[WebhookDrain] cycle complete', result);
  return result;
}

export type ReconcileStuckWebhookEventsOptions = {
  database?: DrizzleDb;
  staleAfterMs?: number;
  now?: Date;
  repository?: WebhookEventsRepository;
};

/**
 * Reconciliation safety net, scoped narrowly to this application's own
 * inbox/drain system (not Strava-side polling reconciliation - see
 * docs/strava-data-policy.md §2 for that separate, larger concern): resets
 * rows stuck in `processing` past `staleAfterMs` (a worker crashed
 * mid-attempt and never reached `succeeded`/`failed`/`dead_letter`) back
 * to retryable via the ordinary retry/backoff/dead-letter decision.
 *
 * Rows that were never picked up at all need no separate handling here:
 * they are simply `pending` with a due `nextAttemptAt`, which
 * `drainWebhookInbox`'s ordinary candidate query already finds on its own
 * next cycle.
 */
export async function reconcileStuckWebhookEvents({
  database = defaultDb,
  staleAfterMs = STALE_PROCESSING_TIMEOUT_MS,
  now = new Date(),
  repository = createWebhookEventsRepository(database),
}: ReconcileStuckWebhookEventsOptions = {}): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const resetCount = await repository.resetStaleProcessing(cutoff, now);
  if (resetCount > 0) {
    logger.warn('[WebhookReconcile] reset stuck "processing" rows back to retryable', {
      resetCount,
      cutoff,
    });
  }
  return resetCount;
}

export type WebhookInboxMetrics = WebhookInboxBacklogMetrics & {
  /** Age of the oldest still-outstanding (`pending`/`failed`) event, in ms - the sync-lag headline number. */
  oldestPendingAgeMs: number | null;
};

export type GetWebhookInboxMetricsOptions = {
  database?: DrizzleDb;
  now?: Date;
  repository?: WebhookEventsRepository;
};

/**
 * Backlog-size-by-status, dead-letter count, and sync-lag metrics for the
 * webhook inbox (issue #125). This codebase has no metrics backend
 * (`~/server/logging/logger.ts` is the established observability
 * primitive), so callers - the drain cron route - log this as a
 * structured line rather than pushing it to a vendor.
 */
export async function getWebhookInboxMetrics({
  database = defaultDb,
  now = new Date(),
  repository = createWebhookEventsRepository(database),
}: GetWebhookInboxMetricsOptions = {}): Promise<WebhookInboxMetrics> {
  const metrics = await repository.backlogMetrics();
  const oldestPendingAgeMs = metrics.oldestPendingEventTime
    ? now.getTime() - metrics.oldestPendingEventTime.getTime()
    : null;
  return { ...metrics, oldestPendingAgeMs };
}
