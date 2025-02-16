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
import { store } from '~/store';

export async function updateActivity(act: UpdatableActivity) {
  try {
    const account = await getAccount({});
    if (!account.access_token) {
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

      store.setState((state) => ({
        ...state,
        notifications: [
          ...state.notifications,
          {
            id: crypto.randomUUID(),
            type: 'success',
            title: 'Activity updated',
            message: `Successfully updated activity "${updatedActivity.name}"`,
          },
        ],
      }));

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
  console.log('Starting fetchStravaActivities with params:', {
    hasAccessToken: !!accessToken,
    before,
    activityIds,
    includePhotos,
    athleteId,
    shouldDeletePhotos,
  });

  const client = new StravaClient(accessToken);
  const photos: Photo[] = [];

  try {
    // Get activities either by IDs or before timestamp
    console.log('Fetching activities from Strava API...');
    const stravaActivities = activityIds
      ? await Promise.all(activityIds.map((id) => client.getActivity(id)))
      : await client.getActivities({
          before,
          per_page: 200,
        });
    console.log(`Fetched ${stravaActivities.length} activities from Strava`);

    // Transform activities
    console.log('Transforming activities...');
    const activities = stravaActivities.map((act) => ({
      ...transformStravaActivity(act),
      athlete: athleteId,
    }));
    console.log(`Transformed ${activities.length} activities`);

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
    if (!account.access_token) {
      throw new Error('No Strava access token found');
    }

    const result = await fetchStravaActivities({
      accessToken: account.access_token,
      activityIds: ids,
      includePhotos,
      athleteId: parseInt(account.providerAccountId),
    });

    store.setState((state) => {
      const notification = {
        id: crypto.randomUUID(),
        type: 'success' as const,
        title: 'Activity refreshed',
        message: `Successfully refreshed ${result.activities.length} ${result.activities.length === 1 ? 'activity' : 'activities'} from Strava`,
      };
      return {
        ...state,
        notifications: [...state.notifications, notification],
      };
    });

    return result;
  } catch (error) {
    store.setState((state) => {
      const notification = {
        id: crypto.randomUUID(),
        type: 'error' as const,
        title: 'Error refreshing activity',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
      return {
        ...state,
        notifications: [...state.notifications, notification],
      };
    });
    throw error;
  }
}

export async function fetchActivitiesBeforeTimestamp(
  timestamp: number,
  includePhotos = false,
) {
  try {
    const account = await getAccount({});
    if (!account.access_token) {
      throw new Error('No Strava access token found');
    }

    const result = await fetchStravaActivities({
      accessToken: account.access_token,
      before: timestamp,
      includePhotos,
      athleteId: parseInt(account.providerAccountId),
    });

    store.setState((state) => ({
      ...state,
      notifications: [
        ...state.notifications,
        {
          id: crypto.randomUUID(),
          type: 'success',
          title: 'Activities loaded',
          message: `Successfully loaded ${result.activities.length} activities from Strava`,
        },
      ],
    }));

    return result;
  } catch (error) {
    store.setState((state) => ({
      ...state,
      notifications: [
        ...state.notifications,
        {
          id: crypto.randomUUID(),
          type: 'error',
          title: 'Error loading activities',
          message:
            error instanceof Error
              ? error.message
              : 'An unknown error occurred',
        },
      ],
    }));
    throw error;
  }
}

/**
 * Handle Strava webhook subscription management
 */
export async function manageWebhook(url: string) {
  const account = await getAccount({});
  if (!account.access_token) {
    throw new Error('No Strava access token found');
  }

  const client = new StravaClient(account.access_token);

  try {
    // Get existing subscriptions
    const subscriptions = await client.getSubscriptions();
    console.log('Subscriptions:', subscriptions);

    // Delete existing subscriptions with different URLs
    await Promise.all(
      subscriptions
        .filter((sub) => sub.callback_url !== url)
        .map((sub) => client.deleteSubscription(sub.id)),
    );

    // Create new subscription if none exists with the current URL
    if (!subscriptions.some((sub) => sub.callback_url === url)) {
      await client.createSubscription(url, process.env.STRAVA_VERIFY_TOKEN!);
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
  console.log('Handling webhook activity:', { activityId, athleteId });

  // Get account directly using Strava athlete ID
  const account = await getAccount({
    providerAccountId: athleteId.toString(),
  });

  if (!account.access_token) {
    throw new Error('No Strava access token found');
  }

  return fetchStravaActivities({
    accessToken: account.access_token,
    activityIds: [activityId],
    includePhotos: true,
    athleteId,
    shouldDeletePhotos: true,
  });
}
