import 'server-only';

import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { deriveIngestionStatus } from '~/server/application/ingestion-status';
import { photoBackfillEnabled } from '~/server/config/photo-backfill';
import { streamBackfillEnabled } from '~/server/config/stream-backfill';
import { db } from '~/server/db';
import {
  accounts,
  backgroundJobRuns,
  stravaRequestBudgets,
  stravaWebhookEvents,
  users,
} from '~/server/db/schema';
import { ingestionStatusRepository } from '~/server/repositories/ingestion-status';
import { scheduledJobLogRepository } from '~/server/repositories/scheduled-job-log';
import { getWebhookInboxMetrics } from '~/server/strava/webhook-drain';

const RECENT_RUNS = 150;
const RECENT_WEBHOOK_FAILURES = 20;

/**
 * Everything the admin dashboard (issue #328) shows, read in one pass:
 * scheduled job health and history, the webhook inbox, per-athlete import
 * coverage, and the shared Strava request budget. Read-only; no payloads,
 * tokens or activity names.
 */
export async function loadAdminDashboard(now = new Date()) {
  const [jobs, runs, inbox, webhookFailures, budgets, athletes] =
    await Promise.all([
      db.select().from(backgroundJobRuns).orderBy(backgroundJobRuns.job),
      scheduledJobLogRepository.recent(RECENT_RUNS),
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
    inbox,
    webhookFailures,
    budgets,
    coverage,
    switches: options,
  };
}

export type AdminDashboard = Awaited<ReturnType<typeof loadAdminDashboard>>;
