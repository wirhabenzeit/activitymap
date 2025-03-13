import { eq, isNotNull, desc, and, asc } from 'drizzle-orm';
import { db } from '~/server/db';
import { activities, activitySync, users } from '~/server/db/schema';
import { getAccount } from '~/server/db/actions';
import { fetchStravaActivities } from './actions';

export type SyncActivityOptions = {
  userId?: string; // If provided, sync only for this user
  maxActivities?: number; // Total max activities to process (default: 50)
  maxIncompleteActivities?: number; // Max incomplete activities to update (default: 25)
  maxOldActivities?: number; // Max old activities to fetch (default: 25)
  minActivitiesThreshold?: number; // Min activities returned to consider we've reached oldest (default: 2)
};

/**
 * Update activities for all users or specific user:
 * 1. Fetch activities older than the oldest existing activity
 * 2. Replace summary activities with detailed ones
 */
export async function syncActivities(
  options: SyncActivityOptions = {}
): Promise<{
  updatedIncomplete: number;
  fetchedOlder: number;
  reachedOldest: string[];
  errors: Record<string, string>;
}> {
  const {
    userId,
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

  // Step 1: Get all users to process (or just the specified user)
  const userQuery = userId 
    ? db.select().from(users).where(eq(users.id, userId))
    : db.select().from(users).where(isNotNull(users.athlete_id));

  const usersToProcess = await userQuery;
  
  console.log(`Processing ${usersToProcess.length} users for activity updates`);

  // Process each user
  for (const user of usersToProcess) {
    if (!user.athlete_id) {
      console.log(`User ${user.id} has no athlete_id, skipping`);
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
        const [newSyncStatus] = await db.insert(activitySync).values({
          id: crypto.randomUUID(),
          user_id: user.id,
          last_sync: new Date(),
          sync_in_progress: true,
        }).returning();
        
        // TypeScript protection: newSyncStatus should always exist after insertion
        if (!newSyncStatus) {
          throw new Error(`Failed to create sync status for user ${user.id}`);
        }
        
        syncStatus = newSyncStatus;
      } else {
        // Update sync status to in progress
        await db.update(activitySync)
          .set({ sync_in_progress: true, last_error: null })
          .where(eq(activitySync.id, syncStatus.id));
      }

      // Get account with refreshed tokens using getAccount
      const account = await getAccount({ userId: user.id });
      if (!account?.access_token) {
        throw new Error(`No valid Strava token found for user ${user.id}`);
      }

      // Get athlete ID from account
      const athleteId = parseInt(account.providerAccountId);

      // Calculate how many activities to process for this user
      const remainingIncomplete = maxIncompleteActivities - updatedIncomplete;
      const remainingOlder = maxOldActivities - fetchedOlder;

      // Step 2: Update incomplete activities if any quota remains
      if (remainingIncomplete > 0) {
        const updated = await updateIncompleteActivities(athleteId, account.access_token, remainingIncomplete);
        updatedIncomplete += updated;
      }

      // Step 3: Fetch older activities if any quota remains and user hasn't reached oldest
      if (remainingOlder > 0 && !user.oldest_activity_reached) {
        const { fetched, reachedOldest: hasReachedOldest } = await fetchOlderActivities(
          athleteId, 
          account.access_token, 
          remainingOlder,
          minActivitiesThreshold
        );
        
        fetchedOlder += fetched;
        
        // Update user if we've reached the oldest activities
        if (hasReachedOldest) {
          await db.update(users)
            .set({ oldest_activity_reached: true })
            .where(eq(users.id, user.id));
          
          reachedOldest.push(user.id);
        }
      }

      // Update sync status to completed
      if (syncStatus) {
        await db.update(activitySync)
          .set({ 
            sync_in_progress: false, 
            last_sync: new Date() 
          })
          .where(eq(activitySync.id, syncStatus.id));
      }

    } catch (error) {
      console.error(`Error processing user ${user.id}:`, error);
      errors[user.id] = error instanceof Error ? error.message : String(error);
      
      // Update sync status with error
      if (syncStatus) {
        await db.update(activitySync)
          .set({ 
            sync_in_progress: false, 
            last_error: error instanceof Error ? error.message : String(error) 
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
      console.log(`Reached max activities limit (${maxActivities}), stopping processing`);
      break;
    }
  }

  return {
    updatedIncomplete,
    fetchedOlder,
    reachedOldest,
    errors,
  };
}

/**
 * Update incomplete activities for a user using fetchStravaActivities
 */
async function updateIncompleteActivities(
  athleteId: number,
  accessToken: string,
  limit: number
): Promise<number> {
  console.log(`Updating up to ${limit} incomplete activities for athlete ${athleteId}`);

  // Get incomplete activities, prioritizing recent ones
  const incompleteActivities = await db
    .select()
    .from(activities)
    .where(and(
      eq(activities.athlete, athleteId),
      eq(activities.is_complete, false)
    ))
    .orderBy(desc(activities.start_date_local))
    .limit(limit);

  if (incompleteActivities.length === 0) {
    console.log(`No incomplete activities found for athlete ${athleteId}`);
    return 0;
  }

  console.log(`Found ${incompleteActivities.length} incomplete activities for athlete ${athleteId}`);

  try {
    // Extract activity IDs to fetch complete versions
    const activityIds = incompleteActivities.map(activity => activity.id);
    
    // Use fetchStravaActivities to get complete activities with full details
    const { activities: updatedActivities } = await fetchStravaActivities({
      accessToken,
      activityIds,
      athleteId,
      includePhotos: false, // No need for photos in this context
      limit
    });

    console.log(`Successfully fetched and updated ${updatedActivities.length} out of ${activityIds.length} activities`);
    return updatedActivities.length;
  } catch (error) {
    console.error(`Error updating incomplete activities for athlete ${athleteId}:`, error);
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
  minActivitiesThreshold: number
): Promise<{ fetched: number, reachedOldest: boolean }> {
  console.log(`Fetching up to ${limit} older activities for athlete ${athleteId}`);

  // Find the oldest activity timestamp
  const oldestActivity = await db
    .select()
    .from(activities)
    .where(eq(activities.athlete, athleteId))
    .orderBy(asc(activities.start_date))
    .limit(1);

  // Default to "now" if no activities found
  const oldestTimestamp = oldestActivity.length > 0 && oldestActivity[0]?.start_date
    ? Math.floor(new Date(oldestActivity[0].start_date).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  console.log(`Oldest activity timestamp: ${oldestTimestamp} (${new Date(oldestTimestamp * 1000).toISOString()})`);

  try {
    // Use fetchStravaActivities to get older activities
    const { activities: olderActivities } = await fetchStravaActivities({
      accessToken,
      before: oldestTimestamp,
      athleteId,
      includePhotos: false,
      limit
    });

    console.log(`Fetched ${olderActivities.length} older activities from Strava`);

    // Check if we've reached the oldest activities
    // If number of activities returned is less than threshold, assume we've reached the end
    const reachedOldest = olderActivities.length < minActivitiesThreshold;

    if (olderActivities.length === 0) {
      console.log('No older activities found');
      return { fetched: 0, reachedOldest: true };
    }

    if (reachedOldest) {
      console.log(`Number of activities (${olderActivities.length}) below threshold (${minActivitiesThreshold}), reached oldest`);
    }

    return {
      fetched: olderActivities.length,
      reachedOldest
    };
  } catch (error) {
    console.error(`Error fetching older activities for athlete ${athleteId}:`, error);
    return { fetched: 0, reachedOldest: false };
  }
}


