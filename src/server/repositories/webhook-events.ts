import 'server-only';

import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import { stravaWebhookEvents, type StravaWebhookEventRow } from '~/server/db/schema';
import {
  classifyWebhookError,
  computeRetryDecision,
  type BackoffDecision,
} from '~/server/strava/webhook-retry';

type DrizzleDb = typeof defaultDb;

const ACTIVE_STATUSES = ['pending', 'failed'] as const;

export type DrainCandidate = Pick<
  StravaWebhookEventRow,
  'id' | 'objectType' | 'aspectType' | 'nextAttemptAt'
>;

export type WebhookInboxBacklogMetrics = {
  countsByStatus: Record<string, number>;
  oldestPendingEventTime: Date | null;
};

export type WebhookEventLease = Pick<
  StravaWebhookEventRow,
  'id' | 'attemptCount' | 'updatedAt'
>;

/**
 * Repository boundary for `strava_webhook_events` drain/retry bookkeeping
 * (issue #125), following the same pattern as
 * `~/server/repositories/mobile-login-codes.ts`'s single-winner atomic
 * claim: `claim` is one conditional `UPDATE ... WHERE status IN (...) AND
 * next_attempt_at <= now() AND id = $1 RETURNING *`, so two concurrent
 * drain workers racing the same row cannot both receive a non-null result
 * - the database's row lock serializes the update, and only the first one
 * finds the row still eligible.
 *
 * Kept separate from `~/server/strava/webhook.ts` so `~/server/strava/
 * webhook-drain.ts`'s orchestration and retry math can be tested against
 * an in-memory fake implementing this interface, the same pattern
 * `~/server/auth/mobile.test.ts` uses for `MobileLoginCodesRepository` -
 * this sandbox has no live Postgres to exercise the real Drizzle queries
 * below against.
 */
export interface WebhookEventsRepository {
  /** Priority-ordered candidates: deletion/deauthorization first, then oldest `nextAttemptAt`. */
  selectDrainCandidates(limit: number, now: Date): Promise<DrainCandidate[]>;

  /**
   * Atomically claims one row for processing - only succeeds if it is
   * currently `pending` or `failed` and due (`nextAttemptAt <= now`).
   * Returns `null` if another worker already claimed it, it is already
   * terminal, or it is not yet due.
   */
  claim(id: string, now: Date): Promise<StravaWebhookEventRow | null>;

  /**
   * Marks a claimed row `succeeded` only while `lease` still owns the
   * current `processing` attempt. Returns false if stale reconciliation has
   * already released/reclaimed it.
   */
  complete(lease: WebhookEventLease, now: Date): Promise<boolean>;

  /**
   * Marks a claimed row `failed` (with backoff) or `dead_letter`
   * (permanent error, or max attempts reached) per `computeRetryDecision`.
   * Returns null if stale reconciliation has already released/reclaimed the
   * lease before this worker records the failure.
   */
  fail(
    lease: WebhookEventLease,
    error: unknown,
    now: Date,
  ): Promise<BackoffDecision | null>;

  /**
   * Resets rows stuck in `processing` past `cutoff` (a worker crashed
   * mid-attempt) back to retryable, applying the same backoff/dead-letter
   * decision as an ordinary failure - see issue #125's reconciliation
   * safety net. Returns how many rows were reset.
   */
  resetStaleProcessing(cutoff: Date, now: Date): Promise<number>;

  /** Rows currently in `status`, most recently updated first - dead-letter rows stay inspectable this way even though the drain query excludes them. */
  listByStatus(
    status: StravaWebhookEventRow['status'],
    limit?: number,
  ): Promise<StravaWebhookEventRow[]>;

  /** Backlog size by status, plus the oldest still-outstanding event's timestamp, for metrics/logging. */
  backlogMetrics(): Promise<WebhookInboxBacklogMetrics>;
}

export function createWebhookEventsRepository(
  database: DrizzleDb = defaultDb,
): WebhookEventsRepository {
  async function applyFailure(
    lease: WebhookEventLease,
    error: unknown,
    now: Date,
  ): Promise<BackoffDecision | null> {
    const message = error instanceof Error ? error.message : String(error);
    const classification = classifyWebhookError(error);
    const decision = computeRetryDecision({
      attemptCount: lease.attemptCount,
      classification,
      now,
    });

    const [updated] = await database
      .update(stravaWebhookEvents)
      .set({
        status: decision.status,
        attemptCount: decision.attemptCount,
        nextAttemptAt: decision.nextAttemptAt,
        lastError: message,
        updatedAt: now,
      })
      .where(
        and(
          eq(stravaWebhookEvents.id, lease.id),
          eq(stravaWebhookEvents.status, 'processing'),
          eq(stravaWebhookEvents.updatedAt, lease.updatedAt),
        ),
      )
      .returning({ id: stravaWebhookEvents.id });

    return updated ? decision : null;
  }

  return {
    async selectDrainCandidates(limit, now) {
      return database
        .select({
          id: stravaWebhookEvents.id,
          objectType: stravaWebhookEvents.objectType,
          aspectType: stravaWebhookEvents.aspectType,
          nextAttemptAt: stravaWebhookEvents.nextAttemptAt,
        })
        .from(stravaWebhookEvents)
        .where(
          and(
            inArray(stravaWebhookEvents.status, ACTIVE_STATUSES),
            lte(stravaWebhookEvents.nextAttemptAt, now),
          ),
        )
        // Deletion/deauthorization events rank ahead of routine
        // create/update events (see `webhookDrainPriorityRank`'s doc
        // comment, kept in sync with this CASE expression), then oldest
        // `nextAttemptAt` first within the same rank.
        .orderBy(
          sql`CASE WHEN ${stravaWebhookEvents.aspectType} = 'delete' OR ${stravaWebhookEvents.objectType} = 'athlete' THEN 0 ELSE 1 END`,
          asc(stravaWebhookEvents.nextAttemptAt),
        )
        .limit(limit);
    },

    async claim(id, now) {
      const [claimed] = await database
        .update(stravaWebhookEvents)
        .set({ status: 'processing', updatedAt: now })
        .where(
          and(
            eq(stravaWebhookEvents.id, id),
            inArray(stravaWebhookEvents.status, ACTIVE_STATUSES),
            lte(stravaWebhookEvents.nextAttemptAt, now),
          ),
        )
        .returning();
      return claimed ?? null;
    },

    async complete(lease, now) {
      const [updated] = await database
        .update(stravaWebhookEvents)
        .set({
          status: 'succeeded',
          attemptCount: sql`${stravaWebhookEvents.attemptCount} + 1`,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(stravaWebhookEvents.id, lease.id),
            eq(stravaWebhookEvents.status, 'processing'),
            eq(stravaWebhookEvents.updatedAt, lease.updatedAt),
          ),
        )
        .returning({ id: stravaWebhookEvents.id });
      return Boolean(updated);
    },

    fail: applyFailure,

    async resetStaleProcessing(cutoff, now) {
      const stale = await database
        .select({
          id: stravaWebhookEvents.id,
          attemptCount: stravaWebhookEvents.attemptCount,
          updatedAt: stravaWebhookEvents.updatedAt,
        })
        .from(stravaWebhookEvents)
        .where(
          and(
            eq(stravaWebhookEvents.status, 'processing'),
            lt(stravaWebhookEvents.updatedAt, cutoff),
          ),
        );

      let resetCount = 0;
      for (const row of stale) {
        const decision = await applyFailure(
          row,
          new Error(
            'Stuck in "processing" past the stale-lock timeout; the worker handling it likely crashed mid-attempt',
          ),
          now,
        );
        if (decision) resetCount++;
      }

      return resetCount;
    },

    async listByStatus(status, limit = 100) {
      return database.query.stravaWebhookEvents.findMany({
        where: eq(stravaWebhookEvents.status, status),
        orderBy: (events, { desc }) => desc(events.updatedAt),
        limit,
      });
    },

    async backlogMetrics() {
      const rows = await database
        .select({
          status: stravaWebhookEvents.status,
          count: sql<number>`count(*)::int`,
        })
        .from(stravaWebhookEvents)
        .groupBy(stravaWebhookEvents.status);

      const countsByStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));

      const [oldestPending] = await database
        .select({ oldest: sql<Date | null>`min(${stravaWebhookEvents.eventTime})` })
        .from(stravaWebhookEvents)
        .where(inArray(stravaWebhookEvents.status, ACTIVE_STATUSES));

      return {
        countsByStatus,
        oldestPendingEventTime: oldestPending?.oldest ?? null,
      };
    },
  };
}

/** Default, database-backed repository used by application services. */
export const webhookEventsRepository = createWebhookEventsRepository();
