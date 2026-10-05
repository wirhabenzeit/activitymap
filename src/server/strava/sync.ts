import { eq, desc, asc } from 'drizzle-orm';
import { db } from '~/server/db';
import { activities, activitySync, users } from '~/server/db/schema';
import { getAccountInternal } from '~/server/db/internal';
import { logger } from '~/server/logging/logger';
import { fetchStravaActivities, StravaPersistenceError } from './service';
import {
  activitiesRepository,
  type ActivitiesRepository,
} from '~/server/repositories/activities';
import {
  ingestionRepository,
  type IngestionRepository,
} from '~/server/repositories/ingestion';
import {
  legacyActivitySyncRepository,
  type LegacyActivitySyncUser,
} from '~/server/repositories/legacy-activity-sync';
import {
  classifyIngestionFailure,
  outcomeForError,
  type DetailFailureCode,
  type IngestionOutcomeRecord,
} from './ingestion-policy';

export type SyncActivityOptions = {
  maxActivities?: number; // Total max activities to process (default: 50)
  maxIncompleteActivities?: number; // Max incomplete activities to update (default: 25)
  maxOldActivities?: number; // Max old activities to fetch (default: 25)
  minActivitiesThreshold?: number; // Min activities returned to consider we've reached oldest (default: 2)
};

/** One step of a user's run: what it committed and how it ended. */
type StepResult = IngestionOutcomeRecord & { committed: number };

const succeeded = (committed = 0): StepResult => ({
  outcome: 'succeeded',
  reason: null,
  committed,
});

/** Outcome of a step that threw before committing anything. */
function stepFailure(error: unknown): StepResult {
  if (error instanceof StravaPersistenceError)
    return { outcome: 'failed', reason: 'persistence_failed', committed: 0 };
  return { ...outcomeForError(error), committed: 0 };
}

/**
 * A user's run outcome. Credential and rate-limit stops dominate; otherwise a
 * failed step only makes the run `failed` when nothing else was committed.
 */
export function combineSteps(steps: StepResult[]): IngestionOutcomeRecord {
  const pick = (outcome: StepResult['outcome']) =>
    steps.find((step) => step.outcome === outcome);
  const blocked = pick('blocked');
  if (blocked) return { outcome: 'blocked', reason: blocked.reason };
  const failure = pick('failed') ?? pick('partial');
  if (failure) {
    const committed = steps.some((step) => step.committed > 0);
    return {
      outcome:
        failure.outcome === 'failed' && !committed ? 'failed' : 'partial',
      reason: failure.reason,
    };
  }
  const deferred = pick('deferred');
  if (deferred) return { outcome: 'deferred', reason: deferred.reason };
  return { outcome: 'succeeded', reason: null };
}

/** Photo failures must stop further Strava work on account/quota errors. */
function photoRefreshOutcome(
  result: Awaited<ReturnType<typeof fetchStravaActivities>>,
): IngestionOutcomeRecord | null {
  if (!result.photoRefreshFailedIds?.length) return null;
  const failures = (result.photoRefreshFailures ?? []).map(({ error }) =>
    classifyIngestionFailure(error),
  );
  const stop =
    failures.find((failure) => failure.scope === 'account') ??
    failures.find((failure) => failure.scope === 'run');
  return stop
    ? { outcome: stop.outcome, reason: stop.reason }
    : { outcome: 'partial', reason: 'photo_refresh_failed' };
}

export type SyncUserDeps = {
  resolveAccessToken?: (userId: string) => Promise<string | null>;
  fetchActivities?: typeof fetchStravaActivities;
  activitiesRepo?: ActivitiesRepository;
  ingestion?: Pick<
    IngestionRepository,
    'findDetailCandidates' | 'recordDetailFailures' | 'clearDetailAttempts'
  >;
  findMostRecentActivityId?: (athleteId: number) => Promise<number | null>;
  findOldestStartDate?: (athleteId: number) => Promise<Date | null>;
};

export type SyncUserResult = {
  outcome: IngestionOutcomeRecord;
  updatedIncomplete: number;
  failedDetails: number;
  fetchedOlder: number;
  reachedOldest: boolean;
  stoppedForRateLimit: boolean;
};

/**
 * One user's legacy sync: refresh the most recent activity (with photos),
 * enrich pending details, then page further back in history. Every step
 * reports what it committed and how it ended; nothing is swallowed into a
 * zero-work success (issue #296).
 */
export async function syncUser(
  user: LegacyActivitySyncUser & { athlete_id: number },
  quota: { incomplete: number; older: number; minActivitiesThreshold: number },
  deps: SyncUserDeps = {},
): Promise<SyncUserResult> {
  const fetchActivities = deps.fetchActivities ?? fetchStravaActivities;
  const ingestion = deps.ingestion ?? ingestionRepository;
  const resolveAccessToken =
    deps.resolveAccessToken ??
    (async (userId: string) => {
      const account = await getAccountInternal({ userId });
      return account?.access_token ?? null;
    });
  const findMostRecentActivityId =
    deps.findMostRecentActivityId ?? findMostRecentActivityIdInDb;
  const findOldestStartDate =
    deps.findOldestStartDate ?? findOldestStartDateInDb;

  const result: SyncUserResult = {
    outcome: { outcome: 'succeeded', reason: null },
    updatedIncomplete: 0,
    failedDetails: 0,
    fetchedOlder: 0,
    reachedOldest: false,
    stoppedForRateLimit: false,
  };

  const accessToken = await resolveAccessToken(user.id);
  if (!accessToken) {
    result.outcome = { outcome: 'blocked', reason: 'credentials_unavailable' };
    return result;
  }
  const athleteId = user.athlete_id;
  const steps: StepResult[] = [];
  const stopped = () =>
    steps.some(
      (step) => step.outcome === 'blocked' || step.outcome === 'deferred',
    );

  // --- Refresh the most recent activity, including its photos ---
  try {
    const mostRecentId = await findMostRecentActivityId(athleteId);
    if (mostRecentId !== null) {
      const recent = await fetchActivities({
        accessToken,
        activityIds: [mostRecentId],
        athleteId,
        includePhotos: true,
        shouldDeletePhotos: true,
        limit: 2,
      });
      await ingestion.clearDetailAttempts(recent.activities.map((a) => a.id));
      const failure = recent.failures?.[0];
      if (failure) {
        steps.push(stepFailure(failure.error));
      } else if (recent.photoRefreshFailedIds?.length) {
        // The activity committed but its photo set is still stale.
        steps.push({
          ...photoRefreshOutcome(recent)!,
          committed: recent.activities.length,
        });
      } else {
        steps.push(succeeded(recent.activities.length));
      }
    }
  } catch (error) {
    logger.error(
      `[User ${user.id}] Error syncing most recent activity:`,
      error,
    );
    steps.push(stepFailure(error));
  }

  // --- Enrich pending details ---
  if (!stopped() && quota.incomplete > 0) {
    const enrichment = await updateIncompleteActivities(
      athleteId,
      accessToken,
      quota.incomplete,
      {
        activitiesRepo: deps.activitiesRepo,
        fetchActivities,
        ingestion,
      },
    );
    result.updatedIncomplete = enrichment.updated;
    result.failedDetails = enrichment.failed;
    steps.push({
      ...enrichment.outcome,
      committed: enrichment.updated + enrichment.deleted,
    });
  }

  // --- Page further back in history ---
  if (!stopped() && quota.older > 0 && !user.oldest_activity_reached) {
    const older = await fetchOlderActivities(
      athleteId,
      accessToken,
      quota.older,
      quota.minActivitiesThreshold,
      { fetchActivities, findOldestStartDate },
    );
    result.fetchedOlder = older.fetched;
    result.reachedOldest = older.reachedOldest;
    if (older.error === undefined) {
      steps.push(succeeded(older.fetched));
    } else {
      const failure = stepFailure(older.error);
      steps.push(
        failure.outcome === 'failed'
          ? { ...failure, reason: 'history_fetch_failed' }
          : failure,
      );
    }
  }

  result.stoppedForRateLimit = steps.some(
    (step) => step.outcome === 'deferred' && step.reason === 'rate_limited',
  );
  result.outcome = combineSteps(steps);
  return result;
}

/**
 * Update activities for all users with Strava accounts:
 * 1. Refresh each user's most recent activity
 * 2. Replace summary activities with detailed ones
 * 3. Fetch activities older than the oldest existing activity
 */
export async function syncActivities(
  options: SyncActivityOptions = {},
  deps: SyncUserDeps & {
    recordOutcome?: IngestionRepository['recordOutcome'];
  } = {},
): Promise<{
  updatedIncomplete: number;
  failedDetails: number;
  fetchedOlder: number;
  reachedOldest: string[];
  errors: Record<string, string>;
  processedUsers: number;
  stoppedForRateLimit: boolean;
}> {
  const {
    maxActivities = 50,
    maxIncompleteActivities = Math.floor(maxActivities / 2),
    maxOldActivities = Math.floor(maxActivities / 2),
    minActivitiesThreshold = 2,
  } = options;
  const recordOutcome = deps.recordOutcome ?? ingestionRepository.recordOutcome;

  // Tracking variables
  let updatedIncomplete = 0;
  let failedDetails = 0;
  let fetchedOlder = 0;
  let stoppedForRateLimit = false;
  const reachedOldest: string[] = [];
  const errors: Record<string, string> = {};

  // Step 1: Get all users with Strava accounts to process.
  //
  // Excludes an athlete whose Strava account has been deauthorized
  // (`accounts.revokedAt` set - see `~/server/strava/webhook.ts`'s
  // `handleAthleteDeauthorization`, issue #125): per
  // docs/strava-data-policy.md §3, once revoked this application must
  // "stop using the stored token - do not attempt another refresh or API
  // call with it". Filtering here, before `getAccountInternal` is ever
  // called for this user, is what actually enforces that - by the time a
  // token-refresh attempt inside `getAccountInternal` could fail, the
  // no-refresh rule has already been violated. This mirrors the same
  // `isNull(accounts.revokedAt)` guard
  // `~/server/repositories/summary-reconciliation.ts`'s `listDue`/`claim`
  // already apply to the periodic summary-reconciliation cron.
  //
  // The repository owns the exact production query and is exercised by a
  // guarded PostgreSQL proof in CI.
  const usersToProcess = await legacyActivitySyncRepository.listEligibleUsers();

  for (const user of usersToProcess) {
    if (!user.athlete_id) continue;

    const syncStatusId = await beginSyncStatus(user.id);
    let outcome: IngestionOutcomeRecord;
    try {
      const userResult = await syncUser(
        { ...user, athlete_id: user.athlete_id },
        {
          incomplete: maxIncompleteActivities - updatedIncomplete,
          older: maxOldActivities - fetchedOlder,
          minActivitiesThreshold,
        },
        deps,
      );
      outcome = userResult.outcome;
      stoppedForRateLimit = userResult.stoppedForRateLimit;
      updatedIncomplete += userResult.updatedIncomplete;
      failedDetails += userResult.failedDetails;
      fetchedOlder += userResult.fetchedOlder;

      if (userResult.reachedOldest) {
        await db
          .update(users)
          .set({ oldest_activity_reached: true })
          .where(eq(users.id, user.id));
        reachedOldest.push(user.id);
      }
    } catch (error) {
      logger.error(`Error processing user ${user.id}:`, error);
      outcome = { outcome: 'failed', reason: 'internal_error' };
    }

    if (outcome.outcome !== 'succeeded') {
      errors[user.id] = outcome.reason ?? outcome.outcome;
    }
    try {
      await recordOutcome(user.id, 'details', outcome);
      await finishSyncStatus(syncStatusId, outcome);
    } catch (error) {
      logger.error(`Failed to record sync outcome for user ${user.id}:`, error);
    }

    // Strava limits are application-wide: later users would only fail too.
    if (stoppedForRateLimit) {
      break;
    }
    // Check if we've hit the overall activities limit
    if (updatedIncomplete + fetchedOlder >= maxActivities) break;
  }

  return {
    updatedIncomplete,
    failedDetails,
    fetchedOlder,
    reachedOldest,
    errors,
    processedUsers: usersToProcess.length,
    stoppedForRateLimit,
  };
}

/** Legacy per-user row; `last_sync` only advances after a fully successful run. */
async function beginSyncStatus(userId: string): Promise<string> {
  const existing = await db.query.activitySync.findFirst({
    where: eq(activitySync.user_id, userId),
    columns: { id: true },
  });
  if (existing) {
    await db
      .update(activitySync)
      .set({ sync_in_progress: true })
      .where(eq(activitySync.id, existing.id));
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.insert(activitySync).values({
    id,
    user_id: userId,
    last_sync: null,
    sync_in_progress: true,
  });
  return id;
}

async function finishSyncStatus(id: string, outcome: IngestionOutcomeRecord) {
  await db
    .update(activitySync)
    .set(
      outcome.outcome === 'succeeded'
        ? { sync_in_progress: false, last_sync: new Date(), last_error: null }
        : {
            sync_in_progress: false,
            last_error: outcome.reason ?? outcome.outcome,
          },
    )
    .where(eq(activitySync.id, id));
}

async function findMostRecentActivityIdInDb(
  athleteId: number,
): Promise<number | null> {
  const mostRecent = await db.query.activities.findFirst({
    where: eq(activities.athlete, athleteId),
    orderBy: desc(activities.start_date),
    columns: { id: true },
  });
  return mostRecent?.id ?? null;
}

async function findOldestStartDateInDb(
  athleteId: number,
): Promise<Date | null> {
  const [oldest] = await db
    .select({ startDate: activities.start_date })
    .from(activities)
    .where(eq(activities.athlete, athleteId))
    .orderBy(asc(activities.start_date))
    .limit(1);
  return oldest?.startDate ?? null;
}

export type UpdateIncompleteActivitiesDeps = {
  activitiesRepo?: ActivitiesRepository;
  fetchActivities?: typeof fetchStravaActivities;
  ingestion?: Pick<
    IngestionRepository,
    'findDetailCandidates' | 'recordDetailFailures' | 'clearDetailAttempts'
  >;
};

export type DetailEnrichmentResult = {
  /** Activities whose details were fetched and committed. */
  updated: number;
  /** Activities Strava confirmed missing and that were deleted. */
  deleted: number;
  /** Activities that failed individually and now back off before a retry. */
  failed: number;
  outcome: IngestionOutcomeRecord;
};

/**
 * Enrich pending activities (`detailEnrichmentPending`) for one athlete.
 *
 * Activity-level failures are recorded with a capped backoff so one failing
 * activity cannot starve the rest; rate limits and rejected credentials stop
 * the batch without blaming any activity. The not-found branch delegates to
 * `ActivitiesRepository.deleteManyForAthlete`, which performs the delete, its
 * tombstone and change-feed entries in one transaction (issues #120/#122).
 */
export async function updateIncompleteActivities(
  athleteId: number,
  accessToken: string,
  limit: number,
  deps: UpdateIncompleteActivitiesDeps = {},
): Promise<DetailEnrichmentResult> {
  const activitiesRepo = deps.activitiesRepo ?? activitiesRepository;
  const fetchActivities = deps.fetchActivities ?? fetchStravaActivities;
  const ingestion = deps.ingestion ?? ingestionRepository;
  const result: DetailEnrichmentResult = {
    updated: 0,
    deleted: 0,
    failed: 0,
    outcome: { outcome: 'succeeded', reason: null },
  };

  const activityIds = await ingestion.findDetailCandidates(athleteId, limit);
  if (activityIds.length === 0) return result;

  let fetched: Awaited<ReturnType<typeof fetchStravaActivities>>;
  try {
    fetched = await fetchActivities({
      accessToken,
      activityIds,
      athleteId,
      includePhotos: true,
      shouldDeletePhotos: true,
      limit,
    });
  } catch (error) {
    logger.error(
      `Error updating incomplete activities for athlete ${athleteId}:`,
      error,
    );
    const { outcome, reason } = stepFailure(error);
    result.outcome = { outcome, reason };
    return result;
  }

  result.updated = fetched.activities.length;
  await ingestion.clearDetailAttempts(fetched.activities.map((a) => a.id));

  const activityFailures: { activityId: number; code: DetailFailureCode }[] =
    [];
  let stop: IngestionOutcomeRecord | null = null;
  for (const { activityId, error } of fetched.failures ?? []) {
    const failure = classifyIngestionFailure(error);
    if (failure.scope === 'activity') {
      activityFailures.push({ activityId, code: failure.code });
    } else if (!stop || failure.outcome === 'blocked') {
      stop = { outcome: failure.outcome, reason: failure.reason };
    }
  }
  await ingestion.recordDetailFailures(activityFailures);
  result.failed = activityFailures.length;

  let deleteFailed = false;
  if (fetched.notFoundIds.length > 0) {
    try {
      const deletedIds = await activitiesRepo.deleteManyForAthlete(
        athleteId,
        fetched.notFoundIds,
      );
      result.deleted = deletedIds.length;
      if (deletedIds.length !== fetched.notFoundIds.length) {
        logger.warn(
          `Mismatch in deleted count. Expected ${fetched.notFoundIds.length}, got ${deletedIds.length}`,
        );
      }
    } catch (deleteError) {
      deleteFailed = true;
      logger.error(
        `Error during database delete operation for athlete ${athleteId}:`,
        deleteError,
      );
    }
  }

  const committed = result.updated + result.deleted > 0;
  const photoOutcome = photoRefreshOutcome(fetched);
  if (photoOutcome?.outcome === 'blocked') {
    result.outcome = photoOutcome;
  } else if (stop) {
    result.outcome = stop;
  } else if (photoOutcome) {
    result.outcome = photoOutcome;
  } else if (activityFailures.length > 0) {
    result.outcome = {
      outcome: committed ? 'partial' : 'failed',
      reason: 'detail_failures',
    };
  } else if (deleteFailed) {
    result.outcome = {
      outcome: committed ? 'partial' : 'failed',
      reason: 'persistence_failed',
    };
  }
  return result;
}

/**
 * Fetch activities older than the oldest existing activity. Summary
 * reconciliation, not this step, is what proves the history complete.
 */
async function fetchOlderActivities(
  athleteId: number,
  accessToken: string,
  limit: number,
  minActivitiesThreshold: number,
  deps: {
    fetchActivities: typeof fetchStravaActivities;
    findOldestStartDate: (athleteId: number) => Promise<Date | null>;
  },
): Promise<{ fetched: number; reachedOldest: boolean; error?: unknown }> {
  try {
    const oldest = await deps.findOldestStartDate(athleteId);
    const oldestTimestamp = Math.floor(
      (oldest?.getTime() ?? Date.now()) / 1000,
    );
    const { activities: olderActivities } = await deps.fetchActivities({
      accessToken,
      before: oldestTimestamp,
      athleteId,
      includePhotos: false,
      limit,
    });
    // If fewer activities than the threshold come back, assume we've reached the end
    return {
      fetched: olderActivities.length,
      reachedOldest: olderActivities.length < minActivitiesThreshold,
    };
  } catch (error) {
    logger.error(
      `Error fetching older activities for athlete ${athleteId}:`,
      error,
    );
    return { fetched: 0, reachedOldest: false, error };
  }
}
