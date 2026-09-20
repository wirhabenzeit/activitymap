import { UserNotFoundError } from '~/server/db/internal';

/**
 * Thrown by `processWebhookEvent` for a failure that retrying will never
 * fix on its own - e.g. the account is disconnected/deauthorized/missing,
 * or the delivery is structurally unsupported. `classifyWebhookError`
 * dead-letters these immediately instead of spending the retry budget on
 * them. See issue #125.
 */
export class PermanentWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentWebhookError';
  }
}

export type WebhookErrorClassification = 'retryable' | 'permanent';

/**
 * Classifies a `processWebhookEvent` failure as `retryable` (network/
 * timeout/5xx from Strava, transient DB errors, or anything not
 * specifically recognized) or `permanent` (an account that will never
 * resolve on its own, or a delivery this application deliberately does
 * not support).
 *
 * Unrecognized errors default to `retryable` on purpose: misclassifying a
 * transient error as permanent would drop an event's data prematurely,
 * while misclassifying a permanent error as retryable only costs it the
 * ordinary retry budget before `computeRetryDecision` dead-letters it
 * anyway once `MAX_WEBHOOK_ATTEMPTS` is reached.
 */
export function classifyWebhookError(error: unknown): WebhookErrorClassification {
  if (error instanceof PermanentWebhookError) return 'permanent';
  if (error instanceof UserNotFoundError) return 'permanent';
  return 'retryable';
}

/**
 * After this many total attempts, a retryable failure dead-letters instead
 * of retrying again. With the backoff schedule below this is a little
 * over 4 hours of wall-clock retrying in the worst case - comfortably
 * inside the 48-hour deletion-processing deadline in
 * docs/strava-data-policy.md §3, while not retrying a broken delivery
 * forever.
 */
export const MAX_WEBHOOK_ATTEMPTS = 10;

/** The first retry after a failure waits this long. */
export const INITIAL_BACKOFF_MS = 30_000; // 30s

/**
 * Backoff never grows past this, so a long-stuck-but-still-retryable row
 * still gets retried every couple of hours rather than effectively going
 * silent between attempts. Doubling from `INITIAL_BACKOFF_MS` reaches this
 * cap on the 9th attempt, one short of `MAX_WEBHOOK_ATTEMPTS`.
 */
export const MAX_BACKOFF_MS = 2 * 60 * 60 * 1000; // 2h

export type WebhookRetryStatus = 'failed' | 'dead_letter';

export type BackoffDecision = {
  status: WebhookRetryStatus;
  /** The row's attempt count after this failed attempt (i.e. `attemptCount` in + 1). */
  attemptCount: number;
  nextAttemptAt: Date;
};

/**
 * Computes the next inbox-row state after a failed processing attempt.
 * `attemptCount` is the row's attempt count *before* this attempt.
 *
 * A `permanent` classification dead-letters immediately, regardless of how
 * many attempts remain - retrying a permanent failure only delays making
 * it visible as needing attention. A `retryable` classification backs off
 * exponentially (doubling from `INITIAL_BACKOFF_MS`, capped at
 * `MAX_BACKOFF_MS`) until `MAX_WEBHOOK_ATTEMPTS` total attempts have been
 * made, at which point it also dead-letters: a persistently-failing
 * transient error still has to stop retrying forever and become
 * inspectable rather than silently held in `failed` indefinitely.
 */
export function computeRetryDecision({
  attemptCount,
  classification,
  now,
}: {
  attemptCount: number;
  classification: WebhookErrorClassification;
  now: Date;
}): BackoffDecision {
  const newAttemptCount = attemptCount + 1;

  if (classification === 'permanent' || newAttemptCount >= MAX_WEBHOOK_ATTEMPTS) {
    return { status: 'dead_letter', attemptCount: newAttemptCount, nextAttemptAt: now };
  }

  const backoffMs = Math.min(
    MAX_BACKOFF_MS,
    INITIAL_BACKOFF_MS * 2 ** (newAttemptCount - 1),
  );
  return {
    status: 'failed',
    attemptCount: newAttemptCount,
    nextAttemptAt: new Date(now.getTime() + backoffMs),
  };
}

export type DrainPriorityEvent = { objectType: string; aspectType: string };

/**
 * Priority rank for drain ordering (issue #125; see
 * docs/strava-data-policy.md §3, "deletion and deauthorization ... must be
 * processed ahead of routine activity create/update events"): activity
 * deletions and athlete deauthorization events rank ahead of routine
 * create/update events so they are never starved behind a backlog. A
 * lower number sorts first.
 */
export function webhookDrainPriorityRank(event: DrainPriorityEvent): number {
  if (event.aspectType === 'delete') return 0;
  if (event.objectType === 'athlete') return 0;
  return 1;
}

/**
 * Stable priority sort applied to a drain batch: priority rank first, then
 * oldest `nextAttemptAt` within the same rank. This mirrors the `ORDER BY`
 * used to select the batch (`selectDrainCandidates`) and is re-applied
 * here immediately before dispatch to the bounded worker pool, since with
 * limited concurrency the dispatch order - not only the fetch order -
 * determines which rows actually get processed first in a given cycle.
 */
export function sortByDrainPriority<
  T extends DrainPriorityEvent & { nextAttemptAt: Date },
>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    const rankDiff = webhookDrainPriorityRank(a) - webhookDrainPriorityRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime();
  });
}
