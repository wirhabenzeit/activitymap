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
import { type UpdatableActivity, type MutableStravaPhoto } from './types';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { webhooks } from '~/server/db/schema';
import type { StravaActivity } from './types';

export async function updateActivity(act: UpdatableActivity) {
  try {
    const account = await getAccount({});
    if (!account || !account.access_token) {
      throw new Error('No Strava access token found');
    }

    const client = new StravaClient(account.access_token);

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

async function fetchStravaActivities({
  accessToken,
  before,
  activityIds,
  includePhotos = false,
  athleteId,
  shouldDeletePhotos = false,
}: {
  accessToken: string;
  before?: number;
  activityIds?: number[];
  includePhotos?: boolean;
  athleteId: number;
  shouldDeletePhotos?: boolean;
}): Promise<{ activities: Activity[]; photos: Photo[] }> {
  console.log('Starting fetchStravaActivities:', {
    has_access_token: !!accessToken,
    before: before ? new Date(before * 1000).toISOString() : undefined,
    activity_ids: activityIds,
    include_photos: includePhotos,
    athlete_id: athleteId,
    should_delete_photos: shouldDeletePhotos,
    timestamp: new Date().toISOString(),
  });

  const client = new StravaClient(accessToken);
  const photos: Photo[] = [];

  try {
    let stravaActivities: StravaActivity[];

    if (activityIds) {
      console.log('Fetching complete activities by IDs:', {
        ids: activityIds,
        count: activityIds.length,
      });
      stravaActivities = await Promise.all(
        activityIds.map(async (id) => {
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
        per_page: 50,
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

    // Transform activities
    const activities = stravaActivities
      .map((act) => {
        // Set isComplete=true for webhook activities (fetched by ID) or when explicitly requested
        const isComplete = !!activityIds;
        console.log(
          `Transforming activity ${act.id} with is_complete=${isComplete}`,
        );
        return transformStravaActivity(act, isComplete);
      })
      .map((act) => ({ ...act, athlete: athleteId }));

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
          photos.push(
            ...activityPhotos.map((photo) =>
              transformStravaPhoto(photo, athleteId),
            ),
          );
        }
      }
      console.log(`Processed ${photos.length} photos total`);
    }

    // Insert into database
    console.log('Inserting activities into database...');
    const result = await db
      .insert(activitySchema)
      .values(activities)
      .onConflictDoUpdate({
        target: activitySchema.id,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          distance: sql`excluded.distance`,
          moving_time: sql`excluded.moving_time`,
          elapsed_time: sql`excluded.elapsed_time`,
          total_elevation_gain: sql`excluded.total_elevation_gain`,
          sport_type: sql`excluded.sport_type`,
          start_date: sql`excluded.start_date`,
          start_date_local: sql`excluded.start_date_local`,
          timezone: sql`excluded.timezone`,
          start_latlng: sql`excluded.start_latlng`,
          end_latlng: sql`excluded.end_latlng`,
          achievement_count: sql`excluded.achievement_count`,
          kudos_count: sql`excluded.kudos_count`,
          comment_count: sql`excluded.comment_count`,
          athlete_count: sql`excluded.athlete_count`,
          photo_count: sql`excluded.photo_count`,
          total_photo_count: sql`excluded.total_photo_count`,
          map_id: sql`excluded.map_id`,
          map_polyline: sql`excluded.map_polyline`,
          map_summary_polyline: sql`excluded.map_summary_polyline`,
          map_bbox: sql`excluded.map_bbox`,
          trainer: sql`excluded.trainer`,
          commute: sql`excluded.commute`,
          manual: sql`excluded.manual`,
          private: sql`excluded.private`,
          flagged: sql`excluded.flagged`,
          workout_type: sql`excluded.workout_type`,
          upload_id: sql`excluded.upload_id`,
          average_speed: sql`excluded.average_speed`,
          max_speed: sql`excluded.max_speed`,
          has_kudoed: sql`excluded.has_kudoed`,
          hide_from_home: sql`excluded.hide_from_home`,
          gear_id: sql`excluded.gear_id`,
          kilojoules: sql`excluded.kilojoules`,
          average_watts: sql`excluded.average_watts`,
          device_watts: sql`excluded.device_watts`,
          max_watts: sql`excluded.max_watts`,
          weighted_average_watts: sql`excluded.weighted_average_watts`,
          elev_high: sql`excluded.elev_high`,
          elev_low: sql`excluded.elev_low`,
          pr_count: sql`excluded.pr_count`,
          calories: sql`excluded.calories`,
          has_heartrate: sql`excluded.has_heartrate`,
          average_heartrate: sql`excluded.average_heartrate`,
          max_heartrate: sql`excluded.max_heartrate`,
          heartrate_opt_out: sql`excluded.heartrate_opt_out`,
          display_hide_heartrate_option: sql`excluded.display_hide_heartrate_option`,
          last_updated: sql`excluded.last_updated`,
          is_complete: sql`excluded.is_complete`,
        },
      })
      .returning();
    console.log(
      `Database insert/update complete. Affected rows: ${result.length}`,
    );

    if (photos.length > 0) {
      console.log('Inserting photos into database...');
      await db
        .insert(photosSchema)
        .values(photos)
        .onConflictDoUpdate({
          target: photosSchema.unique_id,
          set: {
            activity_id: sql`excluded.activity_id`,
            activity_name: sql`excluded.activity_name`,
            caption: sql`excluded.caption`,
            type: sql`excluded.type`,
            source: sql`excluded.source`,
            urls: sql`excluded.urls`,
            sizes: sql`excluded.sizes`,
            default_photo: sql`excluded.default_photo`,
            location: sql`excluded.location`,
            uploaded_at: sql`excluded.uploaded_at`,
            created_at: sql`excluded.created_at`,
            post_id: sql`excluded.post_id`,
            status: sql`excluded.status`,
            resource_state: sql`excluded.resource_state`,
          },
        });
      console.log('Photos insert/update complete');
    }

    return { activities, photos };
  } catch (error) {
    console.error('Error in fetchStravaActivities:', error);
    throw error;
  }
}

export async function fetchActivitiesByIds(
  ids: number[],
  includePhotos = false,
) {
  try {
    const account = await getAccount({});
    if (!account || !account.access_token) {
      throw new Error('No Strava access token found');
    }

    return fetchStravaActivities({
      accessToken: account.access_token,
      activityIds: ids,
      includePhotos,
      athleteId: parseInt(account.providerAccountId),
    });
  } catch (error) {
    console.error('Error fetching activities by IDs:', error);
    throw error;
  }
}

export async function fetchActivitiesBeforeTimestamp(
  timestamp: number,
  includePhotos = false,
) {
  try {
    const account = await getAccount({});
    if (!account || !account.access_token) {
      throw new Error('No Strava access token found');
    }

    return fetchStravaActivities({
      accessToken: account.access_token,
      before: timestamp,
      includePhotos,
      athleteId: parseInt(account.providerAccountId),
    });
  } catch (error) {
    console.error('Error fetching activities before timestamp:', error);
    throw error;
  }
}

/**
 * Handle Strava webhook subscription management
 */
export async function manageWebhook() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  // Construct the webhook URL from PUBLIC_URL
  const webhookUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  const client = new StravaClient(''); // No access token needed for webhook management

  try {
    // Get existing subscriptions from Strava
    const stravaSubscriptions = await client.getSubscriptions();
    console.log('Current Strava subscriptions:', stravaSubscriptions);

    // Find any subscription that matches our URL
    const matchingSubscription = stravaSubscriptions.find(
      (sub) => sub.callback_url === webhookUrl,
    );

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

      // Return the updated subscription status
      return {
        subscriptions: stravaSubscriptions,
        databaseStatus: 'synchronized',
        matchingSubscription,
      };
    } else {
      // No matching subscription found
      return {
        subscriptions: stravaSubscriptions,
        databaseStatus: 'no_matching_subscription',
        matchingSubscription: null,
      };
    }
  } catch (error) {
    console.error('Failed to manage webhook subscription:', error);
    throw error;
  }
}

export async function handleWebhookActivity({
  activityId,
  athleteId,
}: {
  activityId: number;
  athleteId: number;
}) {
  console.log('Starting webhook activity processing:', {
    activityId,
    athleteId,
    timestamp: new Date().toISOString(),
  });

  // Get account directly using Strava athlete ID
  const account = await getAccount({
    providerAccountId: athleteId.toString(),
  });

  console.log('Account lookup result:', {
    found: !!account,
    athlete_id: athleteId,
    has_access_token: account?.access_token ? true : false,
    token_expires_at: account?.expires_at
      ? new Date(account.expires_at * 1000).toISOString()
      : null,
  });

  // If no account found, this user hasn't connected their Strava account to our app
  if (!account) {
    console.log('No account found for athlete ID:', athleteId);
    return { activities: [], photos: [] };
  }

  if (!account.access_token) {
    console.error('Account found but no access token present:', {
      athlete_id: athleteId,
      provider_account_id: account.providerAccountId,
    });
    throw new Error('No Strava access token found');
  }

  try {
    const result = await fetchStravaActivities({
      accessToken: account.access_token,
      activityIds: [activityId],
      includePhotos: true,
      athleteId,
      shouldDeletePhotos: true,
    });

    console.log('Webhook activity processing completed:', {
      activityId,
      athleteId,
      activities_processed: result.activities.length,
      photos_processed: result.photos.length,
      first_activity: result.activities[0]
        ? {
            id: result.activities[0].id,
            name: result.activities[0].name,
            is_complete: result.activities[0].is_complete,
            has_polyline:
              !!result.activities[0].map_polyline ||
              !!result.activities[0].map_summary_polyline,
          }
        : null,
    });

    return result;
  } catch (error) {
    console.error('Error in handleWebhookActivity:', {
      error:
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              stack: error.stack,
            }
          : error,
      activityId,
      athleteId,
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}

export async function checkWebhookStatus() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  // Construct the expected webhook URL
  const expectedUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  // Use manageWebhook to handle subscription status and database synchronization
  const result = await manageWebhook();

  // Return comprehensive status information
  return {
    expectedUrl,
    subscriptions: result.subscriptions,
    hasMatchingSubscription: result.matchingSubscription !== null,
    databaseStatus: result.databaseStatus,
    matchingSubscription: result.matchingSubscription,
  };
}
