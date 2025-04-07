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
import { inArray, eq, and } from 'drizzle-orm';
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

interface StravaApiError extends Error {
  status?: number;
  details?: { message?: string };
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
}): Promise<{ activities: Activity[]; photos: Photo[]; notFoundIds: number[] }> {
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
  const notFoundIds: number[] = [];

  try {
    let stravaActivitiesResult: (StravaActivity | null)[];

    if (requestedActivityIds) {
      console.log('Fetching complete activities by IDs:', {
        ids: requestedActivityIds,
        count: requestedActivityIds.length,
      });
      stravaActivitiesResult = await Promise.all(
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
          } catch (error: unknown) {
            let isNotFoundError = false;
            if (typeof error === 'object' && error !== null) {
              const apiError = error as StravaApiError;
              isNotFoundError =
                apiError.status === 404 &&
                !!(apiError.message?.includes('Record Not Found') ||
                    apiError.details?.message?.includes('Record Not Found'));
            }

            if (isNotFoundError) {
              console.warn(`Activity ${id} not found on Strava (404). Marked for removal.`);
              notFoundIds.push(id);
              return null;
            }
            console.error('Failed to fetch individual activity:', {
              id,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        }),
      );
      stravaActivitiesResult = stravaActivitiesResult;
    } else if (before) {
      console.log('Fetching older activities before timestamp:', {
        before_timestamp: before,
        limit,
      });
      const summaryActivities = await client.getActivities({
        before,
        per_page: limit,
      });
      stravaActivitiesResult = summaryActivities;
    } else {
      console.log('Fetching latest summary activities');
      const summaryActivities = await client.getActivities({ per_page: limit });
      stravaActivitiesResult = summaryActivities;
    }

    const validStravaActivities = stravaActivitiesResult.filter(
      (activity): activity is StravaActivity => activity !== null,
    );

    const fetchedActivities: StravaActivity[] = validStravaActivities;

    if (!fetchedActivities || fetchedActivities.length === 0) {
      console.log('No valid activities fetched or found.');
      return { activities: [], photos: [], notFoundIds };
    }

    const activitiesToProcess = fetchedActivities.map((act) => {
      const isComplete = !!requestedActivityIds || !!act.map?.polyline || !!act.map?.summary_polyline;
      return transformStravaActivity(act, isComplete);
    });

    if (includePhotos && requestedActivityIds) {
      console.log('Photos requested, processing photos...');
      const photoFetchPromises = fetchedActivities.map(async (act) => {
        if (act.map?.polyline || act.map?.summary_polyline) {
          try {
            const activityPhotos: StravaPhoto[] = await client.getActivityPhotos(
              act.id,
            );
            console.log(`Fetched ${activityPhotos.length} photos for activity ${act.id}`);
            return activityPhotos.map((photo) =>
              transformStravaPhoto(photo, act.id),
            ).filter((photo): photo is Photo => photo !== null); // Filter out nulls
          } catch (error) {
            console.error(`Failed to fetch photos for activity ${act.id}:`, error);
            return []; // Return empty array on error for this activity
          }
        } else {
          console.log(`Skipping photo fetch for activity ${act.id} due to missing map data.`);
          return [];
        }
      });

      const photoResults = await Promise.all(photoFetchPromises);
      photos.push(...photoResults.flat());

      if (shouldDeletePhotos && photos.length > 0) {
        const activityIdsWithPhotos = fetchedActivities.map((act) => act.id);
        if (activityIdsWithPhotos.length > 0) {
          console.log(
            `Deleting existing photos for ${activityIdsWithPhotos.length} activities before inserting new ones.`,
          );
          await db
            .delete(photosSchema)
            .where(inArray(photosSchema.activity_id, activityIdsWithPhotos));
        }
      }
      console.log(`Total ${photos.length} photos processed.`);
    } else if (includePhotos) {
      console.log('Photo fetch skipped: Photos only fetched when specific activity IDs are provided.');
    }

    const dbActivities = activitiesToProcess.map((act) => ({
      ...act,
      athlete: athleteId,
    }));

    const activityIds: number[] = dbActivities.map((a) => a.id);
    let existingActivities: { id: number }[] = [];
    if (activityIds.length > 0) {
      existingActivities = await db
        .select({ id: activitySchema.id })
        .from(activitySchema)
        .where(inArray(activitySchema.id, activityIds));
    }

    const existingActivityIds = new Set(existingActivities.map((a) => a.id));

    const newActivities = dbActivities.filter((a) => !existingActivityIds.has(a.id));
    const activitiesToUpdate = requestedActivityIds
      ? dbActivities.filter((a) => existingActivityIds.has(a.id))
      : [];

    console.log(`Found ${existingActivityIds.size} existing activities, ${newActivities.length} new activities`);

    let savedActivities: Activity[] = [];

    if (newActivities.length > 0) {
      console.log('Inserting new activities into database...');
      const insertResult = await db
        .insert(activitySchema)
        .values(newActivities)
        .onConflictDoNothing()
        .returning();
      savedActivities = [...insertResult];
    }

    if (activitiesToUpdate.length > 0) {
      console.log('Updating existing activities in database...');
      const updatePromises = activitiesToUpdate.map(async (activity) => {
        const updateData: Partial<Activity> = {};

        if (activity.name) updateData.name = activity.name;
        if (activity.description !== undefined) updateData.description = activity.description;
        if (activity.sport_type) updateData.sport_type = activity.sport_type;
        if (activity.start_date) updateData.start_date = activity.start_date;
        if (activity.start_date_local) updateData.start_date_local = activity.start_date_local;
        if (activity.elapsed_time !== undefined) updateData.elapsed_time = activity.elapsed_time;
        if (activity.moving_time !== undefined) updateData.moving_time = activity.moving_time;
        if (activity.distance !== undefined) updateData.distance = activity.distance;
        if (activity.total_elevation_gain !== undefined) updateData.total_elevation_gain = activity.total_elevation_gain;
        if (activity.commute !== undefined) updateData.commute = activity.commute;
        if (activity.average_speed !== undefined) updateData.average_speed = activity.average_speed;
        if (activity.max_speed !== undefined) updateData.max_speed = activity.max_speed;
        if (activity.average_heartrate !== undefined) updateData.average_heartrate = activity.average_heartrate;
        if (activity.max_heartrate !== undefined) updateData.max_heartrate = activity.max_heartrate;
        if (activity.gear_id) updateData.gear_id = activity.gear_id;
        if (activity.map_polyline) updateData.map_polyline = activity.map_polyline;
        if (activity.map_summary_polyline) updateData.map_summary_polyline = activity.map_summary_polyline;
        if (activity.map_bbox !== undefined) updateData.map_bbox = activity.map_bbox;
        updateData.is_complete = true;

        if (Object.keys(updateData).length === 0) {
          return null;
        }

        const updateResult = await db
          .update(activitySchema)
          .set(updateData)
          .where(eq(activitySchema.id, activity.id))
          .returning();

        return updateResult.length > 0 && updateResult[0] ? updateResult[0] : null;
      });

      const updateResults = await Promise.all(updatePromises);
      savedActivities.push(...updateResults.filter((res): res is Activity => res !== null));
    }

    console.log(`Upserted/Updated ${savedActivities.length} activities into the database`);

    if (photos.length > 0) {
      console.log('Checking for existing photos before insert...');
      const photoIds: string[] = photos.map((p) => p.unique_id).filter((id): id is string => !!id);
      let existingPhotos: { uniqueId: string | null }[] = [];
      if (photoIds.length > 0) {
        existingPhotos = await db
          .select({ uniqueId: photosSchema.unique_id })
          .from(photosSchema)
          .where(inArray(photosSchema.unique_id, photoIds));
      }

      const existingPhotoIds = new Set(existingPhotos.map((p) => p.uniqueId));
      const newPhotos = photos.filter((p) => p.unique_id && !existingPhotoIds.has(p.unique_id));

      console.log(`Found ${existingPhotoIds.size} existing photos, ${newPhotos.length} new photos`);

      if (newPhotos.length > 0) {
        console.log('Inserting new photos into database...');
        await db
          .insert(photosSchema)
          .values(newPhotos)
          .onConflictDoNothing();
      } else {
        console.log('No new photos to insert');
      }
      console.log('Photos insert complete');
    }

    return { activities: savedActivities, photos, notFoundIds };
  } catch (error) {
    console.error('Error in fetchStravaActivities:', error);
    return { activities: [], photos: [], notFoundIds };
  }
}

export async function deleteActivities(activityIds: number[]): Promise<{
  deletedCount: number;
  errors: string[];
}> {
  if (!activityIds || activityIds.length === 0) {
    return { deletedCount: 0, errors: [] };
  }

  const errors: string[] = [];
  let deletedCount = 0;

  try {
    // Get current user's account info to ensure we only delete their activities
    const account = await getAccount({});
    if (!account?.providerAccountId) {
      throw new Error('User account not found or missing providerAccountId');
    }
    const athleteId = parseInt(account.providerAccountId);

    console.log(`Attempting to delete ${activityIds.length} activities for athlete ${athleteId}:`, activityIds);

    // Perform the deletion
    const deleteResult = await db
      .delete(activitySchema)
      .where(
        and(
          eq(activitySchema.athlete, athleteId),
          inArray(activitySchema.id, activityIds),
        ),
      )
      .returning({ deletedId: activitySchema.id });

    deletedCount = deleteResult.length;
    console.log(`Successfully deleted ${deletedCount} activities from database:`, deleteResult.map(r => r.deletedId));

    // Check if any requested IDs were not deleted (e.g., didn't belong to the user)
    if (deletedCount < activityIds.length) {
      const deletedSet = new Set(deleteResult.map(r => r.deletedId));
      const notDeleted = activityIds.filter(id => !deletedSet.has(id));
      const errorMsg = `Failed to delete some activities (possible permission issue or already deleted): ${notDeleted.join(', ')}`;
      console.warn(errorMsg);
      errors.push(errorMsg);
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error deleting activities:', errorMsg);
    errors.push(`Server error during deletion: ${errorMsg}`);
    // Return partial success if some were deleted before the error
  }

  return { deletedCount, errors };
}

export async function checkWebhookStatus() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  const expectedUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  const client = StravaClient.withoutAuth();

  try {
    const stravaSubscriptions = await client.getSubscriptions();
    console.log('Current Strava subscriptions:', stravaSubscriptions);

    const matchingSubscription = stravaSubscriptions.find(
      (sub) => sub.callback_url === expectedUrl,
    );

    let databaseStatus = 'no_matching_subscription';

    if (matchingSubscription) {
      console.log('Found matching subscription:', matchingSubscription);

      await db
        .insert(webhooks)
        .values({
          id: matchingSubscription.id,
          resource_state: matchingSubscription.resource_state,
          application_id: matchingSubscription.application_id,
          callback_url: matchingSubscription.callback_url,
          created_at: new Date(matchingSubscription.created_at),
          updated_at: new Date(matchingSubscription.updated_at),
          verified: true,
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

export async function createWebhookSubscription() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  const callbackUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    throw new Error('STRAVA_WEBHOOK_VERIFY_TOKEN environment variable is not set');
  }

  console.log('Creating Strava webhook subscription with:', {
    endpoint: '/push_subscriptions',
    client_id: process.env.STRAVA_CLIENT_ID,
    callback_url: callbackUrl,
    verify_token: '***********',
  });

  const client = StravaClient.withoutAuth();

  try {
    const existingSubscriptions = await client.getSubscriptions();

    const existingSubscription = existingSubscriptions.find(
      (sub) => sub.callback_url === callbackUrl,
    );

    if (existingSubscription) {
      console.log('Subscription already exists:', existingSubscription);

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

    const subscription = await client.createSubscription(callbackUrl, verifyToken);
    console.log('Created Strava webhook subscription:', subscription);

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

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      details: 'Make sure your callback URL is publicly accessible and your Strava API credentials are correct',
    };
  }
}
