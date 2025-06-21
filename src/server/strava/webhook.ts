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

  console.log(
    `[Webhook] Processing ${aspect_type} event for ${object_type} ${object_id} (owner: ${owner_id})`,
  );

  // Only process activity events for now
  if (object_type !== 'activity') {
    console.log(`[Webhook] Ignoring non-activity event: ${object_type}`);
    return;
  }

  console.log(`[Webhook] Processing event for activity ID: ${object_id}, owner ID: ${owner_id}`);

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
  console.log(`[Webhook] Fetching activity ${object_id} with photos from Strava`);
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
      console.log(`[Webhook] Activity ${object_id} not found on Strava. Deleting from database.`);
      try {
        await db.delete(activities).where(eq(activities.id, object_id));
        // Cascading delete should handle photos
        console.log(`[Webhook] Successfully deleted activity ${object_id} from database.`);
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

    console.log(
      `[Webhook] Activity ${object_id} fetched successfully with name: "${activityToSave.name}"`,
    );

    // Database Operations within a transaction for atomicity
    await db.transaction(async (tx) => {
      // 1. Upsert the activity
      console.log(`[Webhook] Upserting activity ${activityToSave.id} in database`);
      await tx
        .insert(activities)
        .values(activityToSave) // Already includes athlete ID from transform
        .onConflictDoUpdate({
          target: activities.id,
          set: activityToSave,
        });
      console.log(`[Webhook] Successfully upserted activity ${activityToSave.id}`);

      // 2. Handle photos: Delete existing, then insert new ones
      if (fetchedPhotos.length > 0) {
        console.log(`[Webhook] Deleting existing photos for activity ${activityToSave.id}`);
        await tx.delete(photos).where(eq(photos.activity_id, activityToSave.id));

        console.log(`[Webhook] Inserting ${fetchedPhotos.length} new photos for activity ${activityToSave.id}`);
        await tx.insert(photos).values(fetchedPhotos);
        console.log(`[Webhook] Successfully inserted photos`);
      } else {
        // If includePhotos was true but no photos were returned, ensure existing are deleted
        console.log(`[Webhook] No photos found for activity ${activityToSave.id}, ensuring existing photos are deleted.`);
        await tx.delete(photos).where(eq(photos.activity_id, activityToSave.id));
      }
    });

    console.log(
      `[Webhook] Successfully processed ${aspect_type} event for activity ${object_id} with photos.`,
    );

  } catch (fetchError) {
    console.error(
      `[Webhook] Error during fetch or database operation for activity ${object_id}:`,
      fetchError,
    );
    // Consider specific error handling or re-throwing if needed
  }
}
