'use server';

import { db } from '~/server/db';
import { activities, photos } from '~/server/db/schema';
import { getAccount } from '~/server/db/actions';
import { fetchStravaActivities } from '~/server/strava/actions';
import { eq } from 'drizzle-orm';

export type StravaWebhookEvent = {
  object_type: string;
  object_id: number;
  aspect_type: string;
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, unknown>;
};

/**
 * Process a Strava webhook event
 * This is designed to be called from the API route handler
 */
export async function processWebhookEvent(data: StravaWebhookEvent) {
  const { object_type, object_id, aspect_type, owner_id } = data;



  // Only process activity events for now
  if (object_type !== 'activity') {

    return;
  }



  let account;
  try {
    account = await getAccount({
      providerAccountId: owner_id.toString(),
    });

    if (!account?.access_token) {
      console.error(`[Webhook] No account or valid access token found for athlete ID: ${owner_id}`);
      return;
    }
  } catch (accountError) {
    console.error(
      `[Webhook] Error getting account for athlete ID: ${owner_id}:`,
      accountError,
    );
    return;
  }

  // Fetch the activity details AND photos from Strava using fetchStravaActivities

  try {
    const { activities: fetchedActivities, photos: fetchedPhotos, notFoundIds } =
      await fetchStravaActivities({
        accessToken: account.access_token,
        activityIds: [object_id],
        includePhotos: true,
        athleteId: owner_id,
        shouldDeletePhotos: true, // Indicate intent to replace photos
        limit: 2, // Ensure we only fetch the specific activity
      });

    // Handle case where activity was not found (e.g., deleted)
    if (notFoundIds.includes(object_id)) {

      try {
        await db.delete(activities).where(eq(activities.id, object_id));
        // Cascading delete should handle photos

      } catch (deleteError) {
        console.error(`[Webhook] Error deleting activity ${object_id}:`, deleteError);
        // Log error but potentially continue if needed, or return
      }
      return; // Exit after handling deletion
    }

    // Check if we actually got the activity we requested
    const activityToSave = fetchedActivities.find(act => act.id === object_id);

    if (!activityToSave) {
      console.error(`[Webhook] Failed to fetch details for activity ${object_id} even though it wasn't in notFoundIds.`);
      return;
    }



    // Database Operations within a transaction for atomicity
    await db.transaction(async (tx) => {
      // 1. Upsert the activity

      await tx
        .insert(activities)
        .values(activityToSave) // Already includes athlete ID from transform
        .onConflictDoUpdate({
          target: activities.id,
          set: activityToSave,
        });


      // 2. Handle photos: Delete existing, then insert new ones
      if (fetchedPhotos.length > 0) {

        await tx.delete(photos).where(eq(photos.activity_id, activityToSave.id));


        await tx.insert(photos).values(fetchedPhotos);

      } else {
        // If includePhotos was true but no photos were returned, ensure existing are deleted

        await tx.delete(photos).where(eq(photos.activity_id, activityToSave.id));
      }
    });



  } catch (fetchError) {
    console.error(
      `[Webhook] Error during fetch or database operation for activity ${object_id}:`,
      fetchError,
    );
    // Consider specific error handling or re-throwing if needed
  }
}
