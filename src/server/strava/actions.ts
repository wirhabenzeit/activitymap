'use server';

import {
  activities as activitySchema,
  photos as photosSchema,
  type Activity,
  type Photo,
} from '~/server/db/schema';

import { db } from '~/server/db';
import { getAccount } from '~/server/db/actions';
import { StravaClient } from './client';
import { transformStravaActivity, transformStravaPhoto } from './transforms';
import { type UpdatableActivity, type StravaPhoto } from './types';
import { sql, inArray, eq } from 'drizzle-orm';
import { webhooks, stravaWebhooks } from '~/server/db/schema';
import type { StravaActivity } from './types';
import crypto from 'crypto';

export async function updateActivity(
  act: UpdatableActivity,
  accountInfo?: { access_token: string; providerAccountId: string },
) {
  try {
    // If account info is not provided, fetch it
    const account = accountInfo ?? (await getAccount({}));
    if (!account?.access_token) {
      throw new Error('No Strava access token found');
    }

    const client = StravaClient.withAccessToken(account.access_token);

    try {
      // First update in Strava to ensure we have valid authorization
      const stravaActivity = await client.updateActivity(act.id, {
        name: act.name,
        sport_type: act.sport_type,
        description: act.description,
        commute: act.commute,
        hide_from_home: act.hide_from_home,
        gear_id: act.gear_id,
      });

      // Transform and update in database
      const transformedActivity = {
        ...transformStravaActivity(stravaActivity),
        athlete: parseInt(account.providerAccountId),
      } satisfies Activity;

      const [updatedActivity] = await db
        .insert(activitySchema)
        .values(transformedActivity)
        .onConflictDoUpdate({
          target: activitySchema.id,
          set: transformedActivity,
        })
        .returning();

      if (!updatedActivity) {
        throw new Error('Failed to update activity in database');
      }

      return updatedActivity;
    } catch (error) {
      console.error('Failed to update activity:', error);
      throw new Error('Failed to update activity');
    }
  } catch (error) {
    console.error('Failed to update activity:', error);
    throw new Error('Failed to update activity');
  }
}

export async function fetchStravaActivities({
  accessToken,
  before,
  activityIds: requestedActivityIds,
  includePhotos = false,
  athleteId,
  shouldDeletePhotos = false,
  limit = 50,
}: {
  accessToken: string;
  before?: number;
  activityIds?: number[];
  includePhotos?: boolean;
  athleteId: number;
  shouldDeletePhotos?: boolean;
  limit?: number;
}): Promise<{ activities: Activity[]; photos: Photo[] }> {
  console.log('Starting fetchStravaActivities:', {
    has_access_token: !!accessToken,
    before: before ? new Date(before * 1000).toISOString() : undefined,
    activity_ids: requestedActivityIds,
    include_photos: includePhotos,
    athlete_id: athleteId,
    should_delete_photos: shouldDeletePhotos,
    timestamp: new Date().toISOString(),
  });

  // Token refresh is now handled outside this function
  const client = StravaClient.withAccessToken(accessToken);
  const photos: Photo[] = [];

  try {
    let stravaActivities: StravaActivity[];

    if (requestedActivityIds) {
      console.log('Fetching complete activities by IDs:', {
        ids: requestedActivityIds,
        count: requestedActivityIds.length,
      });
      stravaActivities = await Promise.all(
        requestedActivityIds.map(async (id) => {
          try {
            const activity = await client.getActivity(id);
            console.log('Successfully fetched activity:', {
              id: activity.id,
              name: activity.name,
              type: activity.sport_type,
              has_polyline:
                !!activity.map.polyline || !!activity.map.summary_polyline,
            });
            return activity;
          } catch (error) {
            console.error('Failed to fetch individual activity:', {
              id,
              error: error instanceof Error ? error.message : error,
            });
            throw error;
          }
        }),
      );
    } else {
      console.log('Fetching summary activities');
      stravaActivities = await client.getActivities({
        before,
        per_page: limit,
      });
    }

    console.log('Activity fetch completed:', {
      total_activities: stravaActivities.length,
      first_activity: stravaActivities[0]
        ? {
            id: stravaActivities[0].id,
            name: stravaActivities[0].name,
            type: stravaActivities[0].sport_type,
          }
        : null,
    });



    // Get photos if requested
    if (includePhotos) {
      console.log('Photos requested, processing photos...');
      // Delete existing photos only if explicitly requested
      if (shouldDeletePhotos && stravaActivities.length > 0) {
        console.log('Deleting existing photos...');
        await db
          .delete(photosSchema)
          .where(
            sql`${photosSchema.activity_id} IN (${stravaActivities
              .map((a) => a.id)
              .join(', ')})`,
          );
      }

      // Then fetch and insert new photos
      for (const activity of stravaActivities) {
        if (activity.total_photo_count > 0) {
          console.log(`Fetching photos for activity ${activity.id}...`);
          const activityPhotos = await client.getActivityPhotos(activity.id);
          // Transform photos and filter out null values (placeholders)
          const transformedPhotos = activityPhotos
            .map((photo: StravaPhoto) => transformStravaPhoto(photo, athleteId))
            .filter((photo): photo is Photo => photo !== null);

          if (transformedPhotos.length > 0) {
            photos.push(...transformedPhotos);
          }

          // Log if any photos were filtered out
          if (transformedPhotos.length < activityPhotos.length) {
            console.log(
              `Filtered out ${activityPhotos.length - transformedPhotos.length} placeholder photos for activity ${activity.id}`,
            );
          }
        }
      }
      console.log(`Processed ${photos.length} photos total`);
    }

    // Transform activities
    const activities: Activity[] = stravaActivities
      .map((act) => {
        // Set isComplete=true for webhook activities (fetched by ID) or when explicitly requested
        const isComplete = !!requestedActivityIds;
        console.log(
          `Transforming activity ${act.id} with is_complete=${isComplete}`,
        );
        return transformStravaActivity(act, isComplete);
      })
      .map((act) => ({ ...act, athlete: athleteId }));
      
    // First check which activities already exist in the database
    console.log('Checking for existing activities...');
    const activityIds: number[] = activities.map((a: Activity) => a.id);
    const existingActivities = await db
      .select({ id: activitySchema.id })
      .from(activitySchema)
      .where(inArray(activitySchema.id, activityIds));
    
    const existingActivityIds = new Set(existingActivities.map(a => a.id));
    
    // Filter to only new activities or activities that need to be updated
    const newActivities = activities.filter((a: Activity) => !existingActivityIds.has(a.id));
    // Only update if explicitly requested by IDs
    const activitiesToUpdate = requestedActivityIds && requestedActivityIds.length > 0 ? activities : [];
    
    console.log(`Found ${existingActivityIds.size} existing activities, ${newActivities.length} new activities`);
    
    // Insert new activities
    let result: Activity[] = [];
    
    if (newActivities.length > 0) {
      console.log('Inserting new activities into database...');
      const insertResult = await db
        .insert(activitySchema)
        .values(newActivities)
        .returning();
      result = [...insertResult];
    }
    
    // Update existing activities only if explicitly requested by IDs
    if (activitiesToUpdate.length > 0) {
      console.log('Updating existing activities in database...');
      for (const activity of activitiesToUpdate) {
        // Skip undefined activities
        if (!activity || !existingActivityIds.has(activity.id)) {
          continue;
        }
        
        // We need to create a clean object with only the fields we want to update
        // to avoid type issues with the complex schema
        // Using a more specific type to avoid 'any'
        const updateData: Partial<Omit<Activity, 'id'>> = {};
        
        // Only include properties that exist and are not null/undefined
        if (activity.name) updateData.name = activity.name;
        if (activity.description !== undefined) updateData.description = activity.description;
        if (activity.distance !== undefined) updateData.distance = activity.distance;
        if (activity.moving_time !== undefined) updateData.moving_time = activity.moving_time;
        if (activity.elapsed_time !== undefined) updateData.elapsed_time = activity.elapsed_time;
        if (activity.total_elevation_gain !== undefined) updateData.total_elevation_gain = activity.total_elevation_gain;
        if (activity.sport_type) updateData.sport_type = activity.sport_type;
        if (activity.start_date) updateData.start_date = activity.start_date;
        if (activity.start_date_local) updateData.start_date_local = activity.start_date_local;
        if (activity.timezone) updateData.timezone = activity.timezone;
        if (activity.start_latlng !== undefined) updateData.start_latlng = activity.start_latlng;
        if (activity.end_latlng !== undefined) updateData.end_latlng = activity.end_latlng;
        if (activity.achievement_count !== undefined) updateData.achievement_count = activity.achievement_count;
        if (activity.kudos_count !== undefined) updateData.kudos_count = activity.kudos_count;
        if (activity.comment_count !== undefined) updateData.comment_count = activity.comment_count;
        if (activity.athlete_count !== undefined) updateData.athlete_count = activity.athlete_count;
        if (activity.photo_count !== undefined) updateData.photo_count = activity.photo_count;
        if (activity.total_photo_count !== undefined) updateData.total_photo_count = activity.total_photo_count;
        if (activity.map_id) updateData.map_id = activity.map_id;
        if (activity.map_polyline) updateData.map_polyline = activity.map_polyline;
        if (activity.map_summary_polyline) updateData.map_summary_polyline = activity.map_summary_polyline;
        if (activity.map_bbox !== undefined) updateData.map_bbox = activity.map_bbox;
        if (activity.is_complete !== undefined) updateData.is_complete = activity.is_complete;
        
        // Only proceed with update if we have data to update
        if (Object.keys(updateData).length === 0) {
          continue;
        }
        
        const updateResult = await db
          .update(activitySchema)
          .set(updateData)
          .where(eq(activitySchema.id, activity.id))
          .returning();
          
        if (updateResult.length > 0 && updateResult[0]) {
          result.push(updateResult[0]);
        }
      }
    }
    console.log(
      `Database insert/update complete. Affected rows: ${result.length}`,
    );

    if (photos.length > 0) {
      console.log('Checking for existing photos...');
      const photoIds = photos.map((p: Photo) => p.unique_id);
      const existingPhotos = await db
        .select({ uniqueId: photosSchema.unique_id })
        .from(photosSchema)
        .where(inArray(photosSchema.unique_id, photoIds));
      
      const existingPhotoIds = new Set(existingPhotos.map(p => p.uniqueId));
      const newPhotos = photos.filter((p: Photo) => !existingPhotoIds.has(p.unique_id));
      
      console.log(`Found ${existingPhotoIds.size} existing photos, ${newPhotos.length} new photos`);
      
      if (newPhotos.length > 0) {
        console.log('Inserting new photos into database...');
        await db
          .insert(photosSchema)
          .values(newPhotos);
        console.log(`Inserted ${newPhotos.length} new photos`);
      } else {
        console.log('No new photos to insert');
      }
      
      console.log('Photos insert complete');
    }

    return { activities, photos };
  } catch (error) {
    console.error('Error in fetchStravaActivities:', error);
    throw error;
  }
}

export async function checkWebhookStatus() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  // Construct the webhook URL from PUBLIC_URL
  const expectedUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  // No userId needed for webhook management (no auth required)
  const client = StravaClient.withoutAuth(); // No access token needed for webhook management

  try {
    // Get existing subscriptions from Strava
    const stravaSubscriptions = await client.getSubscriptions();
    console.log('Current Strava subscriptions:', stravaSubscriptions);

    // Find any subscription that matches our URL
    const matchingSubscription = stravaSubscriptions.find(
      (sub) => sub.callback_url === expectedUrl,
    );

    let databaseStatus = 'no_matching_subscription';

    if (matchingSubscription) {
      console.log('Found matching subscription:', matchingSubscription);

      // Insert or update the subscription in our database
      await db
        .insert(webhooks)
        .values({
          id: matchingSubscription.id,
          resource_state: matchingSubscription.resource_state,
          application_id: matchingSubscription.application_id,
          callback_url: matchingSubscription.callback_url,
          created_at: new Date(matchingSubscription.created_at),
          updated_at: new Date(matchingSubscription.updated_at),
          verified: true, // If it exists in Strava, it's verified
          active: true,
        })
        .onConflictDoUpdate({
          target: webhooks.id,
          set: {
            resource_state: matchingSubscription.resource_state,
            application_id: matchingSubscription.application_id,
            callback_url: matchingSubscription.callback_url,
            updated_at: new Date(matchingSubscription.updated_at),
            verified: true,
            active: true,
          },
        });

      databaseStatus = 'synchronized';
    }

    // Return comprehensive status information
    return {
      expectedUrl,
      subscriptions: stravaSubscriptions,
      hasMatchingSubscription: !!matchingSubscription,
      databaseStatus,
      matchingSubscription,
    };
  } catch (error) {
    console.error('Failed to manage webhook subscription:', error);
    throw error;
  }
}

/**
 * Creates a new webhook subscription with Strava
 * This should only be used in development mode
 */
export async function createWebhookSubscription() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  // Construct the webhook URL from PUBLIC_URL
  const callbackUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  // Get the verification token from environment variables
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  
  if (!verifyToken) {
    throw new Error('STRAVA_WEBHOOK_VERIFY_TOKEN environment variable is not set');
  }
  
  console.log('Creating Strava webhook subscription with:', {
    endpoint: '/push_subscriptions',
    client_id: process.env.STRAVA_CLIENT_ID,
    callback_url: callbackUrl,
    verify_token: '***********', // Masked for security
  });

  // No userId needed for webhook management (no auth required)
  const client = StravaClient.withoutAuth();

  try {
    // First, check if we already have existing subscriptions
    const existingSubscriptions = await client.getSubscriptions();
    
    // Check if there's already a subscription with the same callback URL
    const existingSubscription = existingSubscriptions.find(
      (sub) => sub.callback_url === callbackUrl
    );
    
    if (existingSubscription) {
      console.log('Subscription already exists:', existingSubscription);
      
      // Update our database record with the existing subscription
      await db
        .insert(stravaWebhooks)
        .values({
          id: crypto.randomUUID(),
          subscriptionId: existingSubscription.id,
          verifyToken,
          callbackUrl,
        })
        .onConflictDoUpdate({
          target: [stravaWebhooks.callbackUrl],
          set: {
            verifyToken,
            updatedAt: new Date(),
          },
        });
      
      return {
        success: true,
        subscription: existingSubscription,
        message: 'Using existing subscription',
      };
    }
    
    // Create the subscription
    const subscription = await client.createSubscription(callbackUrl, verifyToken);
    console.log('Created Strava webhook subscription:', subscription);

    // Insert the subscription into our database or update if it already exists
    await db
      .insert(stravaWebhooks)
      .values({
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        verifyToken,
        callbackUrl,
      })
      .onConflictDoUpdate({
        target: [stravaWebhooks.callbackUrl],
        set: {
          subscriptionId: subscription.id,
          verifyToken,
          updatedAt: new Date(),
        },
      });

    return {
      success: true,
      subscription,
      message: 'Created new subscription',
    };
  } catch (error) {
    console.error('Failed to create webhook subscription:', error);
    
    // Return a more detailed error response
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      details: 'Make sure your callback URL is publicly accessible and your Strava API credentials are correct',
    };
  }
}
