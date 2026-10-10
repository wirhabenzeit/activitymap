import 'server-only';

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { deriveIngestionStatus } from '~/server/application/ingestion-status';
import { photoBackfillEnabled } from '~/server/config/photo-backfill';
import { streamBackfillEnabled } from '~/server/config/stream-backfill';
import { db } from '~/server/db';
import {
  accounts,
  activities,
  activityDetailAttempts,
  activityStreams,
  backgroundJobRuns,
  photoFetchAttempts,
  streamBackfillAttempts,
  stravaRequestBudgets,
  stravaWebhookEvents,
  users,
} from '~/server/db/schema';
import { detailEnrichmentPending } from '~/server/repositories/ingestion';
import { photoRefreshPending } from '~/server/repositories/photo-backfill';
import { ingestionStatusRepository } from '~/server/repositories/ingestion-status';
import { scheduledJobLogRepository } from '~/server/repositories/scheduled-job-log';
import { getWebhookInboxMetrics } from '~/server/strava/webhook-drain';

const RECENT_RUNS = 150;
const PROBLEM_RUNS = 100;
const RECENT_WEBHOOK_FAILURES = 20;
const ACTIVITY_FAILURES_PER_PIPELINE = 50;

export type ActivityFailure = {
  pipeline: 'details' | 'streams' | 'photos';
  activityId: string;
  athleteId: number;
  code: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  /** Null when the failure is terminal and will not be retried. */
  nextAttemptAt: Date | null;
};

/**
 * Activities whose latest attempt failed and that are still outstanding, per
 * pipeline. The attempt tables keep only a code; the cause is in the run log.
 */
async function loadActivityFailures(): Promise<ActivityFailure[]> {
  const sameGeneration = sql`${streamBackfillAttempts.generation} is not distinct from ${activityStreams.generation}`;
  const [details, streams, photos] = await Promise.all([
    db
      .select({
        activityId: sql<string>`${activities.id}::text`,
        athleteId: activities.athlete,
        code: activityDetailAttempts.lastErrorCode,
        attempts: activityDetailAttempts.attemptCount,
        lastAttemptAt: activityDetailAttempts.lastAttemptAt,
        nextAttemptAt: activityDetailAttempts.nextAttemptAt,
      })
      .from(activityDetailAttempts)
      .innerJoin(
        activities,
        eq(activities.id, activityDetailAttempts.activityId),
      )
      .where(detailEnrichmentPending)
      .orderBy(desc(activityDetailAttempts.lastAttemptAt))
      .limit(ACTIVITY_FAILURES_PER_PIPELINE),
    db
      .select({
        activityId: sql<string>`${activities.id}::text`,
        athleteId: activities.athlete,
        code: sql<string | null>`${streamBackfillAttempts.lastError}->>'code'`,
        attempts: streamBackfillAttempts.attemptCount,
        lastAttemptAt: streamBackfillAttempts.lastAttemptAt,
        nextAttemptAt:
          sql<Date | null>`case when ${streamBackfillAttempts.terminal} and ${sameGeneration} then null else ${streamBackfillAttempts.nextAttemptAt} end`.mapWith(
            streamBackfillAttempts.nextAttemptAt,
          ),
      })
      .from(streamBackfillAttempts)
      .innerJoin(
        activities,
        eq(activities.id, sql`${streamBackfillAttempts.activityId}`),
      )
      .leftJoin(
        activityStreams,
        eq(activityStreams.activityId, streamBackfillAttempts.activityId),
      )
      .where(
        and(
          isNotNull(streamBackfillAttempts.lastError),
          sql`(${activityStreams.fetchedAt} is null or ${activityStreams.invalidatedAt} is not null)`,
        ),
      )
      .orderBy(desc(streamBackfillAttempts.lastAttemptAt))
      .limit(ACTIVITY_FAILURES_PER_PIPELINE),
    db
      .select({
        activityId: sql<string>`${activities.id}::text`,
        athleteId: activities.athlete,
        code: photoFetchAttempts.lastErrorCode,
        attempts: photoFetchAttempts.attemptCount,
        nextAttemptAt: photoFetchAttempts.nextAttemptAt,
      })
      .from(photoFetchAttempts)
      .innerJoin(activities, eq(activities.id, photoFetchAttempts.activityId))
      .where(
        and(isNotNull(photoFetchAttempts.lastErrorCode), photoRefreshPending),
      )
      .orderBy(desc(photoFetchAttempts.nextAttemptAt))
      .limit(ACTIVITY_FAILURES_PER_PIPELINE),
  ]);
  return [
    ...details.map((row) => ({ ...row, pipeline: 'details' as const })),
    ...streams.map((row) => ({ ...row, pipeline: 'streams' as const })),
    ...photos.map((row) => ({
      ...row,
      lastAttemptAt: null,
      pipeline: 'photos' as const,
    })),
  ];
}

/**
 * Everything the admin dashboard (issue #328) shows, read in one pass:
 * scheduled job health and history, the webhook inbox, per-athlete import
 * coverage, and the shared Strava request budget. Read-only; no payloads,
 * tokens or activity names.
 */
export async function loadAdminDashboard(now = new Date()) {
  const [
    jobs,
    runs,
    problemRuns,
    inbox,
    webhookFailures,
    budgets,
    athletes,
    failures,
  ] = await Promise.all([
    db.select().from(backgroundJobRuns).orderBy(backgroundJobRuns.job),
    scheduledJobLogRepository.recent(RECENT_RUNS),
    scheduledJobLogRepository.problems(PROBLEM_RUNS),
    getWebhookInboxMetrics({ now }),
    db
      .select({
        id: stravaWebhookEvents.id,
        status: stravaWebhookEvents.status,
        objectType: stravaWebhookEvents.objectType,
        aspectType: stravaWebhookEvents.aspectType,
        ownerId: stravaWebhookEvents.ownerId,
        attemptCount: stravaWebhookEvents.attemptCount,
        lastError: stravaWebhookEvents.lastError,
        updatedAt: stravaWebhookEvents.updatedAt,
      })
      .from(stravaWebhookEvents)
      .where(inArray(stravaWebhookEvents.status, ['failed', 'dead_letter']))
      .orderBy(desc(stravaWebhookEvents.updatedAt))
      .limit(RECENT_WEBHOOK_FAILURES),
    db.select().from(stravaRequestBudgets).orderBy(stravaRequestBudgets.key),
    db
      .select({
        userId: users.id,
        name: users.name,
        athleteId: users.athlete_id,
        revokedAt: accounts.revokedAt,
      })
      .from(users)
      .innerJoin(
        accounts,
        and(eq(accounts.userId, users.id), eq(accounts.providerId, 'strava')),
      )
      .where(isNotNull(users.athlete_id))
      .orderBy(users.name),
    loadActivityFailures(),
  ]);

  const options = {
    streamBackfillEnabled: streamBackfillEnabled(),
    photoBackfillEnabled: photoBackfillEnabled(),
  };
  const coverage = await Promise.all(
    athletes.map(async (athlete) => ({
      ...athlete,
      status: deriveIngestionStatus(
        await ingestionStatusRepository.snapshot(
          athlete.userId,
          athlete.athleteId!,
          now,
        ),
        options,
      ),
    })),
  );

  return {
    observedAt: now,
    jobs,
    runs,
    problemRuns,
    inbox,
    webhookFailures,
    budgets,
    coverage,
    activityFailures: failures,
    switches: options,
  };
}

export type AdminDashboard = Awaited<ReturnType<typeof loadAdminDashboard>>;
