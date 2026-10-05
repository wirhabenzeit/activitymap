import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import {
  accounts,
  activities,
  activityDetailAttempts as detailAttempts,
  activityStreams,
  backgroundJobRuns,
  ingestionOutcomes,
  photos,
  photoFetchAttempts,
  stravaSummaryReconciliations,
  streamBackfillAccounts,
  streamBackfillAttempts,
  users,
  type BackgroundJobRun,
  type IngestionOutcomeRow,
} from '~/server/db/schema';
import type {
  IngestionJob,
  IngestionPipeline,
} from '~/server/strava/ingestion-policy';
import { detailEnrichmentPending } from './ingestion';
import { photoRefreshPending } from './photo-backfill';

type DrizzleDb = typeof defaultDb;

/**
 * Raw, account-scoped facts behind the ingestion status (issues #296/#297).
 * Every count partitions the account's stored activities unless its name says
 * otherwise. Reading this never calls Strava, never loads stream samples or
 * media, and never writes.
 */
export type IngestionSnapshot = {
  observedAt: Date;
  account: {
    /** A Strava grant exists and is neither revoked nor scheduled for erasure. */
    connected: boolean;
    updatedAt: Date | null;
    /** Strava rejected the current credentials for stream backfill. */
    streamCredentialsBlocked: boolean;
  };
  history: {
    lastSummaryReconciledAt: Date | null;
    scan: {
      phase: 'scanning' | 'confirming';
      nextPage: number;
      scanStartedAt: Date;
    } | null;
  };
  activities: {
    total: number;
    oldestStartDate: Date | null;
    newestStartDate: Date | null;
    detailed: number;
    neverDetailed: number;
    invalidated: number;
    /** Overlapping: pending activities backing off after a failure. */
    detailRetryWaiting: number;
    detailNextRetryAt: Date | null;
  };
  photos: {
    activitiesWithPhotos: number;
    activitiesWithStoredPhotos: number;
    current: number;
    refreshRequired: number;
    unknown: number;
    photoCount: number;
    pendingRefreshes?: number;
    retryWaiting?: number;
    nextRetryAt?: Date | null;
  };
  streams: {
    withData: number;
    withoutData: number;
    /** Overlapping: current streams whose derived chart summary is stored. */
    chartSummaries: number;
    failed: number;
    waiting: number;
    runnable: number;
    /** Overlapping: outstanding activities whose earlier streams were invalidated. */
    invalidated: number;
    nextRetryAt: Date | null;
  };
  outcomes: Partial<Record<IngestionPipeline, IngestionOutcomeRow>>;
  jobs: Partial<Record<IngestionJob, BackgroundJobRun>>;
};

const count = (condition: ReturnType<typeof sql>) =>
  sql<number>`count(*) filter (where ${condition})::integer`;

export function createIngestionStatusRepository(
  database: DrizzleDb = defaultDb,
) {
  /**
   * Partition every activity by stream state, using the same `needsFetch`,
   * terminal-generation and retry rules as the backfill selector. Only
   * lifecycle metadata is read; `payload` and `summary` are never decoded.
   */
  async function streamCounts(
    athleteId: number,
    now: string,
  ): Promise<IngestionSnapshot['streams']> {
    const needsFetch = sql`(${activityStreams.fetchedAt} is null or ${activityStreams.invalidatedAt} is not null)`;
    const sameGeneration = sql`${streamBackfillAttempts.generation} is not distinct from ${activityStreams.generation}`;
    const terminal = sql`(${streamBackfillAttempts.terminal} is true and ${sameGeneration})`;
    const retryAt = sql`greatest(
      case when ${activityStreams.leaseExpiresAt} > ${now}::timestamp then ${activityStreams.leaseExpiresAt} end,
      case when ${activityStreams.nextRetryAt} > ${now}::timestamp then ${activityStreams.nextRetryAt} end,
      case when ${streamBackfillAttempts.leaseExpiresAt} > ${now}::timestamp then ${streamBackfillAttempts.leaseExpiresAt} end,
      case when ${sameGeneration} and ${streamBackfillAttempts.nextAttemptAt} > ${now}::timestamp then ${streamBackfillAttempts.nextAttemptAt} end
    )`;
    const current = sql`(${activityStreams.fetchedAt} is not null and ${activityStreams.invalidatedAt} is null)`;
    const [row] = await database
      .select({
        withData: count(
          sql`${current} and cardinality(${activityStreams.availableTypes}) > 0`,
        ),
        withoutData: count(
          sql`${current} and cardinality(${activityStreams.availableTypes}) = 0`,
        ),
        chartSummaries: count(
          sql`${current} and ${activityStreams.summary} is not null`,
        ),
        failed: count(sql`${needsFetch} and ${terminal}`),
        waiting: count(
          sql`${needsFetch} and not ${terminal} and ${retryAt} is not null`,
        ),
        runnable: count(
          sql`${needsFetch} and not ${terminal} and ${retryAt} is null`,
        ),
        invalidated: count(sql`${activityStreams.invalidatedAt} is not null`),
        nextRetryAt:
          sql<Date | null>`min(${retryAt}) filter (where ${needsFetch} and not ${terminal})`.mapWith(
            activityStreams.nextRetryAt,
          ),
      })
      .from(activities)
      .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
      .leftJoin(
        streamBackfillAttempts,
        eq(streamBackfillAttempts.activityId, activities.id),
      )
      .where(eq(activities.athlete, athleteId));
    return row ?? emptyStreams;
  }

  return {
    async snapshot(
      userId: string,
      athleteId: number,
      observedAt: Date,
    ): Promise<IngestionSnapshot> {
      const now = observedAt.toISOString();
      const stravaAccount = sql`(
        select a.id from account a where a."userId" = ${userId}
          and a."providerId" = 'strava' and a."accountId" = ${String(athleteId)}
        order by a.id limit 1
      )`;
      const pendingRetry = sql`${detailEnrichmentPending} and ${detailAttempts.nextAttemptAt} > ${now}::timestamp`;

      const [
        [account],
        [user],
        [scan],
        [activityCounts],
        [photoCounts],
        streams,
        outcomeRows,
        jobRows,
        [photoQueue],
      ] = await Promise.all([
        database
          .select({
            connected: sql<boolean>`(${accounts.revokedAt} is null
              and ${accounts.scheduledErasureAt} is null
              and (coalesce(${accounts.accessToken}, ${accounts.access_token}, '') <> ''
                or coalesce(${accounts.refreshToken}, ${accounts.refresh_token}, '') <> ''))`,
            updatedAt: accounts.updatedAt,
            // Same fingerprint as stream backfill's account block.
            streamCredentialsBlocked: sql<boolean>`coalesce(${streamBackfillAccounts.blockedCredentials}
              = concat_ws('|', ${accounts.accessTokenExpiresAt}, ${accounts.expiresAt}, ${accounts.expires_at}, ${accounts.updatedAt}), false)`,
          })
          .from(accounts)
          .leftJoin(
            streamBackfillAccounts,
            eq(streamBackfillAccounts.userId, accounts.userId),
          )
          .where(eq(accounts.id, stravaAccount)),
        database
          .select({ lastSummaryReconciledAt: users.lastSummaryReconciledAt })
          .from(users)
          .where(eq(users.id, userId)),
        database
          .select({
            phase: stravaSummaryReconciliations.phase,
            nextPage: stravaSummaryReconciliations.nextPage,
            scanStartedAt: stravaSummaryReconciliations.scanStartedAt,
          })
          .from(stravaSummaryReconciliations)
          .where(eq(stravaSummaryReconciliations.athleteId, athleteId)),
        database
          .select({
            total: sql<number>`count(*)::integer`,
            oldestStartDate:
              sql<Date | null>`min(${activities.start_date})`.mapWith(
                activities.start_date,
              ),
            newestStartDate:
              sql<Date | null>`max(${activities.start_date})`.mapWith(
                activities.start_date,
              ),
            detailed: count(sql`${activities.geometryState} = 'detailed'`),
            neverDetailed: count(sql`${activities.geometryState} = 'summary'`),
            invalidated: count(
              sql`${activities.geometryState} = 'refresh_required'`,
            ),
            detailRetryWaiting: count(pendingRetry),
            detailNextRetryAt:
              sql<Date | null>`min(${detailAttempts.nextAttemptAt}) filter (where ${pendingRetry})`.mapWith(
                detailAttempts.nextAttemptAt,
              ),
          })
          .from(activities)
          .leftJoin(
            detailAttempts,
            eq(detailAttempts.activityId, activities.id),
          )
          .where(eq(activities.athlete, athleteId)),
        database
          .select({
            activitiesWithPhotos: sql<number>`count(*)::integer`,
            activitiesWithStoredPhotos: count(sql`exists (
              select 1 from ${photos}
              where ${photos.activity_id} = ${activities.id}
                and ${photos.athlete_id} = ${athleteId}
            )`),
            current: count(sql`${activities.photosState} = 'current'`),
            refreshRequired: count(
              sql`${activities.photosState} = 'refresh_required'`,
            ),
            unknown: count(sql`${activities.photosState} is null`),
            photoCount: sql<number>`(select count(*)::integer from ${photos} where ${photos.athlete_id} = ${athleteId})`,
          })
          .from(activities)
          .where(
            and(
              eq(activities.athlete, athleteId),
              sql`greatest(coalesce(${activities.total_photo_count}, 0), coalesce(${activities.photo_count}, 0)) > 0`,
            ),
          ),
        streamCounts(athleteId, now),
        database
          .select()
          .from(ingestionOutcomes)
          .where(eq(ingestionOutcomes.userId, userId)),
        database.select().from(backgroundJobRuns),
        database
          .select({
            pendingRefreshes: count(photoRefreshPending),
            retryWaiting: count(
              sql`${photoRefreshPending} and ${photoFetchAttempts.nextAttemptAt} > ${now}::timestamp`,
            ),
            nextRetryAt:
              sql<Date | null>`min(${photoFetchAttempts.nextAttemptAt}) filter (where ${photoRefreshPending} and ${photoFetchAttempts.nextAttemptAt} > ${now}::timestamp)`.mapWith(
                photoFetchAttempts.nextAttemptAt,
              ),
          })
          .from(activities)
          .leftJoin(
            photoFetchAttempts,
            eq(photoFetchAttempts.activityId, activities.id),
          )
          .where(eq(activities.athlete, athleteId)),
      ]);

      return {
        observedAt,
        account: {
          connected: account?.connected ?? false,
          updatedAt: account?.updatedAt ?? null,
          streamCredentialsBlocked: account?.streamCredentialsBlocked ?? false,
        },
        history: {
          lastSummaryReconciledAt: user?.lastSummaryReconciledAt ?? null,
          scan: scan ?? null,
        },
        activities: activityCounts ?? {
          total: 0,
          oldestStartDate: null,
          newestStartDate: null,
          detailed: 0,
          neverDetailed: 0,
          invalidated: 0,
          detailRetryWaiting: 0,
          detailNextRetryAt: null,
        },
        photos: {
          ...photoQueue,
          ...(photoCounts ?? {
            activitiesWithPhotos: 0,
            activitiesWithStoredPhotos: 0,
            current: 0,
            refreshRequired: 0,
            unknown: 0,
            photoCount: 0,
          }),
        },
        streams,
        outcomes: Object.fromEntries(
          outcomeRows.map((row) => [row.pipeline, row]),
        ),
        jobs: Object.fromEntries(jobRows.map((row) => [row.job, row])),
      };
    },
  };
}

const emptyStreams: IngestionSnapshot['streams'] = {
  withData: 0,
  withoutData: 0,
  chartSummaries: 0,
  failed: 0,
  waiting: 0,
  runnable: 0,
  invalidated: 0,
  nextRetryAt: null,
};

export type IngestionStatusRepository = ReturnType<
  typeof createIngestionStatusRepository
>;

export const ingestionStatusRepository = createIngestionStatusRepository();
