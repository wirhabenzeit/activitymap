import { eq, isNotNull, desc, and, asc, notExists, sql } from 'drizzle-orm';
import { db } from '~/server/db';
import { accounts, activities, activitySync, users } from '~/server/db/schema';
import { getAccountInternal } from '~/server/db/internal';
import { logger } from '~/server/logging/logger';
import { fetchStravaActivities } from './service';
import {
  activitiesRepository,
  type ActivitiesRepository,
} from '~/server/repositories/activities';

export type SyncActivityOptions = {
  maxActivities?: number; // Total max activities to process (default: 50)
  maxIncompleteActivities?: number; // Max incomplete activities to update (default: 25)
  maxOldActivities?: number; // Max old activities to fetch (default: 25)
  minActivitiesThreshold?: number; // Min activities returned to consider we've reached oldest (default: 2)
};

/**
 * Update activities for all users with Strava accounts:
 * 1. Fetch activities older than the oldest existing activity
 * 2. Replace summary activities with detailed ones
 */
export async function syncActivities(
  options: SyncActivityOptions = {},
): Promise<{
  updatedIncomplete: number;
  fetchedOlder: number;
  reachedOldest: string[];
  errors: Record<string, string>;
  processedUsers: number;
}> {
  const {
    maxActivities = 50,
    maxIncompleteActivities = Math.floor(maxActivities / 2),
    maxOldActivities = Math.floor(maxActivities / 2),
    minActivitiesThreshold = 2,
  } = options;

  // Tracking variables
  let updatedIncomplete = 0;
  let fetchedOlder = 0;
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
  // A `NOT EXISTS` subquery, not a join, so this query's result shape stays
  // exactly the flat `users` row the rest of this function already expects
  // (a join would nest the result under per-table keys).
  const usersToProcess = await db
    .select()
    .from(users)
    .where(
      and(
        isNotNull(users.athlete_id),
        notExists(
          db
            .select({ one: sql`1` })
            .from(accounts)
            .where(
              and(
                eq(accounts.userId, users.id),
                eq(accounts.providerId, 'strava'),
                isNotNull(accounts.revokedAt),
              ),
            ),
        ),
      ),
    );



  // Process each user
  for (const user of usersToProcess) {
    if (!user.athlete_id) {

      continue;
    }

    // Initialize sync status outside try/catch for scope access
    let syncStatus = null;

    try {
      // Get or create sync status record
      syncStatus = await db.query.activitySync.findFirst({
        where: eq(activitySync.user_id, user.id),
      });

      // Create sync record if it doesn't exist
      if (!syncStatus) {
        const [newSyncStatus] = await db
          .insert(activitySync)
          .values({
            id: crypto.randomUUID(),
            user_id: user.id,
            last_sync: new Date(),
            sync_in_progress: true,
          })
          .returning();

        // TypeScript protection: newSyncStatus should always exist after insertion
        if (!newSyncStatus) {
          throw new Error(`Failed to create sync status for user ${user.id}`);
        }

        syncStatus = newSyncStatus;
      } else {
        // Update sync status to in progress
        await db
          .update(activitySync)
          .set({ sync_in_progress: true, last_error: null })
          .where(eq(activitySync.id, syncStatus.id));
      }

      // Get account with refreshed tokens using getAccount
      const account = await getAccountInternal({ userId: user.id });
      if (!account?.access_token) {
        throw new Error(`No valid Strava token found for user ${user.id}`);
      }

      // Get athlete ID from account
      const athleteId = parseInt(account.accountId);

      // --- Sync most recent activity ---
      try {
        const mostRecentActivity = await db.query.activities.findFirst({
          where: eq(activities.athlete, athleteId),
          orderBy: desc(activities.start_date),
          columns: { id: true },
        });

        if (mostRecentActivity) {

          await fetchStravaActivities({
            accessToken: account.access_token,
            activityIds: [mostRecentActivity.id],
            athleteId,
            includePhotos: true, // Ensure photos are updated
            shouldDeletePhotos: true, // Add this line to replace existing photos
            limit: 2, // Only fetching one activity
          });

        } else {

        }
      } catch (recentSyncError) {
        logger.error(
          `[User ${user.id}/${athleteId}] Error syncing most recent activity:`,
          recentSyncError,
        );
        // Log error but continue with other sync steps
        errors[`user_${user.id}_recent`] =
          (recentSyncError as Error).message ||
          'Unknown error syncing recent activity';
      }
      // --- End sync most recent activity ---

      // Calculate how many activities to process for this user
      const remainingIncomplete = maxIncompleteActivities - updatedIncomplete;
      const remainingOlder = maxOldActivities - fetchedOlder;

      // Step 2: Update incomplete activities if any quota remains
      if (remainingIncomplete > 0) {
        const updated = await updateIncompleteActivities(
          athleteId,
          account.access_token,
          remainingIncomplete,
        );
        updatedIncomplete += updated;
      }

      // Step 3: Fetch older activities if any quota remains and user hasn't reached oldest
      if (remainingOlder > 0 && !user.oldest_activity_reached) {
        const { fetched, reachedOldest: hasReachedOldest } =
          await fetchOlderActivities(
            athleteId,
            account.access_token,
            remainingOlder,
            minActivitiesThreshold,
          );

        fetchedOlder += fetched;

        // Update user if we've reached the oldest activities
        if (hasReachedOldest) {
          await db
            .update(users)
            .set({ oldest_activity_reached: true })
            .where(eq(users.id, user.id));

          reachedOldest.push(user.id);
        }
      }

      // Update sync status to completed
      if (syncStatus) {
        await db
          .update(activitySync)
          .set({
            sync_in_progress: false,
            last_sync: new Date(),
          })
          .where(eq(activitySync.id, syncStatus.id));
      }
    } catch (error) {
      logger.error(`Error processing user ${user.id}:`, error);
      errors[user.id] = error instanceof Error ? error.message : String(error);

      // Update sync status with error
      if (syncStatus) {
        await db
          .update(activitySync)
          .set({
            sync_in_progress: false,
            last_error: error instanceof Error ? error.message : String(error),
          })
          .where(eq(activitySync.id, syncStatus.id));
      } else {
        // Create error record if sync status doesn't exist
        await db.insert(activitySync).values({
          id: crypto.randomUUID(),
          user_id: user.id,
          last_sync: new Date(),
          sync_in_progress: false,
          last_error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Check if we've hit the overall activities limit
    if (updatedIncomplete + fetchedOlder >= maxActivities) {

      break;
    }
  }

  return {
    updatedIncomplete,
    fetchedOlder,
    reachedOldest,
    errors,
    processedUsers: usersToProcess.length,
  };
}

async function findIncompleteActivityIdsInDb(
  athleteId: number,
  limit: number,
): Promise<number[]> {
  const incompleteActivities = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(eq(activities.athlete, athleteId), eq(activities.is_complete, false)),
    )
    .orderBy(desc(activities.start_date_local))
    .limit(limit);
  return incompleteActivities.map((activity) => activity.id);
}

export type UpdateIncompleteActivitiesDeps = {
  activitiesRepo?: ActivitiesRepository;
  fetchActivities?: typeof fetchStravaActivities;
  findIncompleteActivityIds?: typeof findIncompleteActivityIdsInDb;
};

/**
 * Update incomplete activities for a user using fetchStravaActivities.
 *
 * Exported (and given an injectable `deps`) so
 * `~/server/strava/sync.test.ts` can prove the not-found/delete branch below
 * delegates to `ActivitiesRepository.deleteManyForAthlete` - and therefore
 * gets the same one-transaction delete+tombstone+change-record atomicity
 * that repository method already has - without a live database or a real
 * Strava API call.
 */
export async function updateIncompleteActivities(
  athleteId: number,
  accessToken: string,
  limit: number,
  deps: UpdateIncompleteActivitiesDeps = {},
): Promise<number> {
  const activitiesRepo = deps.activitiesRepo ?? activitiesRepository;
  const fetchActivities = deps.fetchActivities ?? fetchStravaActivities;
  const findIncompleteActivityIds =
    deps.findIncompleteActivityIds ?? findIncompleteActivityIdsInDb;

  // Get incomplete activities, prioritizing recent ones
  const activityIds = await findIncompleteActivityIds(athleteId, limit);

  if (activityIds.length === 0) {

    return 0;
  }



  try {
    // Use fetchStravaActivities to get complete activities with full details
    const { activities: updatedActivities, notFoundIds } =
      await fetchActivities({
        accessToken,
        activityIds,
        athleteId,
        includePhotos: false, // No need for photos in this context
        limit,
      });

    // Delete activities that were not found on Strava. This delegates to
    // `ActivitiesRepository.deleteManyForAthlete`, which performs the
    // delete, its tombstone insert, and its `sync_change` change-feed
    // entries (including for any photo cascade-deleted with it) inside one
    // database transaction - fixing the same non-atomic
    // delete-then-separately-tombstone bug already fixed for the webhook
    // path (#133) and for this same method's own former inline duplicate of
    // it (issue #120's review), rather than re-implementing that
    // transaction a third time here. See issue #122.
    if (notFoundIds && notFoundIds.length > 0) {
      try {
        const deletedIds = await activitiesRepo.deleteManyForAthlete(
          athleteId,
          notFoundIds,
        );

        if (deletedIds.length !== notFoundIds.length) {
          logger.warn(
            `Mismatch in deleted count. Expected ${notFoundIds.length}, got ${deletedIds.length}`,
          );
        }
      } catch (deleteError) {
        logger.error(
          `Error during database delete operation for athlete ${athleteId}:`,
          deleteError,
        );
        // Optionally re-throw or handle appropriately if deletion is critical
      }
    }


    return updatedActivities.length;
  } catch (error) {
    logger.error(
      `Error updating incomplete activities for athlete ${athleteId}:`,
      error,
    );
    return 0;
  }
}

/**
 * Fetch activities older than the oldest existing activity using fetchStravaActivities
 */
async function fetchOlderActivities(
  athleteId: number,
  accessToken: string,
  limit: number,
  minActivitiesThreshold: number,
): Promise<{ fetched: number; reachedOldest: boolean }> {


  // Find the oldest activity timestamp
  const oldestActivity = await db
    .select()
    .from(activities)
    .where(eq(activities.athlete, athleteId))
    .orderBy(asc(activities.start_date))
    .limit(1);

  // Default to "now" if no activities found
  const oldestTimestamp =
    oldestActivity.length > 0 && oldestActivity[0]?.start_date
      ? Math.floor(new Date(oldestActivity[0].start_date).getTime() / 1000)
      : Math.floor(Date.now() / 1000);


  try {
    // Use fetchStravaActivities to get older activities
    const { activities: olderActivities } = await fetchStravaActivities({
      accessToken,
      before: oldestTimestamp,
      athleteId,
      includePhotos: false,
      limit,
    });



    // Check if we've reached the oldest activities
    // If number of activities returned is less than threshold, assume we've reached the end
    const reachedOldest = olderActivities.length < minActivitiesThreshold;

    if (olderActivities.length === 0) {

      return { fetched: 0, reachedOldest: true };
    }

    if (reachedOldest) {

    }

    return {
      fetched: olderActivities.length,
      reachedOldest,
    };
  } catch (error) {
    logger.error(
      `Error fetching older activities for athlete ${athleteId}:`,
      error,
    );
    return { fetched: 0, reachedOldest: false };
  }
}
