import 'server-only';

import { and, desc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import {
  activities,
  activityDetailAttempts as detailAttempts,
  backgroundJobRuns,
  ingestionOutcomes,
} from '~/server/db/schema';
import {
  detailRetryAt,
  type DetailFailureCode,
  type IngestionJob,
  type IngestionOutcomeRecord,
  type IngestionPipeline,
} from '~/server/strava/ingestion-policy';

type DrizzleDb = typeof defaultDb;

/**
 * The single definition of "this activity still needs its details" (issue
 * #296), shared by the enrichment worker and the status read model. Both a
 * never-fetched summary and a previously detailed route invalidated by
 * summary reconciliation qualify. A detailed activity without GPS, sensors or
 * photos is complete: absence of data is a valid outcome.
 */
export const detailEnrichmentPending = ne(activities.geometryState, 'detailed');

export type JobFinish = {
  status: 'completed' | 'failed' | 'disabled';
  stopReason?: string | null;
};

export function createIngestionRepository(
  database: DrizzleDb = defaultDb,
  clock = () => new Date(),
) {
  return {
    /** Pending activities not backing off after a failure, newest first. */
    findDetailCandidates: async (athleteId: number, limit: number) => {
      const now = clock();
      const rows = await database
        .select({ id: activities.id })
        .from(activities)
        .leftJoin(detailAttempts, eq(detailAttempts.activityId, activities.id))
        .where(
          and(
            eq(activities.athlete, athleteId),
            detailEnrichmentPending,
            or(
              isNull(detailAttempts.nextAttemptAt),
              lte(detailAttempts.nextAttemptAt, now),
            ),
          ),
        )
        .orderBy(desc(activities.start_date_local))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    recordDetailFailures: async (
      failures: { activityId: number; code: DetailFailureCode }[],
    ) => {
      if (failures.length === 0) return;
      const now = clock();
      // One statement per activity keeps each backoff derived from its own
      // attempt count; batches are bounded by the worker's per-run limit.
      for (const { activityId, code } of failures) {
        const [existing] = await database
          .select({ attemptCount: detailAttempts.attemptCount })
          .from(detailAttempts)
          .where(eq(detailAttempts.activityId, activityId));
        const attemptCount = (existing?.attemptCount ?? 0) + 1;
        const values = {
          attemptCount,
          lastAttemptAt: now,
          nextAttemptAt: detailRetryAt(now, attemptCount),
          lastErrorCode: code,
        };
        // A concurrently deleted activity simply has nothing to back off.
        await database
          .insert(detailAttempts)
          .select(
            database
              .select({
                activityId: activities.id,
                attemptCount: sql`${values.attemptCount}`.as('attempt_count'),
                lastAttemptAt: sql`${now.toISOString()}::timestamp`.as(
                  'last_attempt_at',
                ),
                nextAttemptAt:
                  sql`${values.nextAttemptAt.toISOString()}::timestamp`.as(
                    'next_attempt_at',
                  ),
                lastErrorCode: sql`${code}`.as('last_error_code'),
              })
              .from(activities)
              .where(eq(activities.id, activityId)),
          )
          .onConflictDoUpdate({ target: detailAttempts.activityId, set: values });
      }
    },

    clearDetailAttempts: async (activityIds: number[]) => {
      if (activityIds.length === 0) return;
      await database
        .delete(detailAttempts)
        .where(inArray(detailAttempts.activityId, activityIds));
    },

    recordOutcome: async (
      userId: string,
      pipeline: IngestionPipeline,
      record: IngestionOutcomeRecord,
    ) => {
      const now = clock();
      const values = {
        lastAttemptAt: now,
        outcome: record.outcome,
        reason: record.reason,
        retryAt: record.retryAt ?? null,
        ...(record.outcome === 'succeeded' ? { lastSucceededAt: now } : {}),
      };
      await database
        .insert(ingestionOutcomes)
        .values({ userId, pipeline, ...values })
        .onConflictDoUpdate({
          target: [ingestionOutcomes.userId, ingestionOutcomes.pipeline],
          set: values,
        });
    },

    startJob: async (job: IngestionJob) => {
      const now = clock();
      const values = {
        lastStartedAt: now,
        lastFinishedAt: null,
        lastStatus: 'running' as const,
        lastStopReason: null,
      };
      await database
        .insert(backgroundJobRuns)
        .values({ job, ...values })
        .onConflictDoUpdate({ target: backgroundJobRuns.job, set: values });
    },

    finishJob: async (job: IngestionJob, finish: JobFinish) => {
      const now = clock();
      const values = {
        lastFinishedAt: now,
        lastStatus: finish.status,
        lastStopReason: finish.stopReason ?? null,
        ...(finish.status === 'completed' ? { lastCompletedAt: now } : {}),
      };
      await database
        .insert(backgroundJobRuns)
        .values({ job, lastStartedAt: now, ...values })
        .onConflictDoUpdate({ target: backgroundJobRuns.job, set: values });
    },
  };
}

export type IngestionRepository = ReturnType<typeof createIngestionRepository>;

export const ingestionRepository = createIngestionRepository();
