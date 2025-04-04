'use server';

import { db } from '~/server/db';
import { activities } from '~/server/db/schema';
import { getAccount } from '~/server/db/actions';
import { StravaClient } from '~/server/strava/client';
import { transformStravaActivity } from '~/server/strava/transforms';

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

  // Find the user account associated with this athlete ID
  console.log(`[Webhook] Looking up account for athlete ID: ${owner_id}`);

  let account;
  try {
    account = await getAccount({
      providerAccountId: owner_id.toString(),
    });

    if (!account) {
      console.error(`[Webhook] No account found for athlete ID: ${owner_id}`);
      return;
    }
  } catch (accountError) {
    console.error(
      `[Webhook] Error getting account for athlete ID: ${owner_id}:`,
      accountError,
    );
    return;
  }

  console.log(`[Webhook] Found account for athlete ID: ${owner_id}`);
  console.log(
    `[Webhook] Access token available: ${!!account.access_token}, Refresh token available: ${!!account.refresh_token}`,
  );

  let client;
  try {
    // Add token refresh callback to update tokens in database
    client = StravaClient.withTokens(
      account.access_token ?? '',
      account.refresh_token ?? '',
      async (_tokens) => {
        console.log(`[Webhook] Tokens refreshed during webhook processing`);
        // We don't need to update the database here as getAccount already handles this
      },
    );

    // Client is initialized - we don't need to log details here as the StravaClient constructor already logs this information
  } catch (clientError) {
    console.error(`[Webhook] Error creating Strava client:`, clientError);
    return;
  }

  // Fetch the activity details from Strava
  console.log(`[Webhook] Fetching activity ${object_id} from Strava`);
  let stravaActivity;
  try {
    stravaActivity = await client.getActivity(object_id);

    if (!stravaActivity) {
      console.error(
        `[Webhook] Failed to fetch activity ${object_id} from Strava - null response`,
      );
      return;
    }

    console.log(
      `[Webhook] Activity ${object_id} fetched successfully with name: "${stravaActivity.name}"`,
    );
  } catch (apiError) {
    console.error(
      `[Webhook] Error fetching activity ${object_id} from Strava:`,
      apiError,
    );
    return;
  }

  try {
    // Transform the Strava activity to our database format
    const transformedActivity = transformStravaActivity(stravaActivity, true);

    // Add the athlete ID from the owner_id
    const activityWithAthlete = {
      ...transformedActivity,
      athlete: owner_id,
    };

    // Log the activity data structure (without sensitive data)
    console.log(`[Webhook] Activity data structure:`, {
      id: activityWithAthlete.id,
      name: activityWithAthlete.name,
      sport_type: activityWithAthlete.sport_type,
      start_date: activityWithAthlete.start_date,
      athlete: activityWithAthlete.athlete,
      has_map_polyline: !!activityWithAthlete.map_polyline,
      has_map_summary_polyline: !!activityWithAthlete.map_summary_polyline,
      photo_count: activityWithAthlete.photo_count ?? 0,
      total_photo_count: activityWithAthlete.total_photo_count ?? 0,
      is_complete: activityWithAthlete.is_complete ?? false,
    });

    // Upsert the activity in the database
    console.log(
      `[Webhook] Upserting activity ${activityWithAthlete.id} in database`,
    );
    try {
      await db
        .insert(activities)
        .values(activityWithAthlete)
        .onConflictDoUpdate({
          target: activities.id,
          set: activityWithAthlete,
        });
      console.log(
        `[Webhook] Successfully upserted activity ${activityWithAthlete.id}`,
      );
    } catch (dbError) {
      console.error(
        `[Webhook] Error upserting activity ${activityWithAthlete.id}:`,
        dbError,
      );
      return;
    }

    console.log(
      `[Webhook] Successfully processed ${aspect_type} event for activity ${object_id}`,
    );
  } catch (transformError) {
    console.error(
      `[Webhook] Error transforming activity ${object_id}:`,
      transformError,
    );
    return;
  }
}
