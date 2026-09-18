import 'server-only';

import {
  activities as activitySchema,
  photoDeletions,
  photos as photosSchema,
  type Activity,
  type Photo,
} from '~/server/db/schema';

import { db } from '~/server/db';
import { StravaClient } from './client';
import { transformStravaActivity, transformStravaPhoto } from './transforms';
import { type StravaPhoto } from './types';
import { inArray, sql } from 'drizzle-orm';
import type { StravaActivity } from './types';
import { fetchActivitiesSchema, type FetchActivitiesInput } from './validators';

/**
 * Internal application service. This file intentionally has no 'use server'
 * directive: it accepts a caller-supplied Strava access token and athlete ID,
 * so it must only ever be invoked from trusted server-side code (webhook
 * processing, scheduled sync, or a Server Action that has already resolved
 * these values itself via getAuthenticatedAccount/getAccountInternal).
 * It must never be exported from a 'use server' file, which would make it
 * directly network-callable with client-supplied credentials. See issue #116.
 */

interface StravaApiError extends Error {
  status?: number;
  details?: { message?: string };
}

export async function fetchStravaActivities(
  input: FetchActivitiesInput,
): Promise<{ activities: Activity[]; photos: Photo[]; notFoundIds: number[] }> {

  const {
    accessToken,
    before,
    after,
    page,
    per_page,
    activityIds: requestedActivityIds,
    includePhotos,
    athleteId,
    shouldDeletePhotos,
    limit
  } = fetchActivitiesSchema.parse(input);


  // Token refresh is now handled outside this function
  const client = StravaClient.withAccessToken(accessToken);
  const photos: Photo[] = [];
  const notFoundIds: number[] = [];

  try {
    let stravaActivitiesResult: (StravaActivity | null)[];

    if (requestedActivityIds) {

      stravaActivitiesResult = await Promise.all(
        requestedActivityIds.map(async (id) => {
          try {
            const activity = await client.getActivity(id);

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
    } else {
      // List/Summary mode
      const params: Parameters<StravaClient['getActivities']>[0] = {
        per_page: per_page ?? limit,
      };
      if (before) params.before = before;
      if (after) params.after = after;
      if (page) params.page = page;

      stravaActivitiesResult = await client.getActivities(params);
    }

    const validStravaActivities = stravaActivitiesResult.filter(
      (activity): activity is StravaActivity => activity !== null,
    );

    const fetchedActivities: StravaActivity[] = validStravaActivities;

    if (!fetchedActivities || fetchedActivities.length === 0) {

      return { activities: [], photos: [], notFoundIds };
    }

    const activitiesToProcess = fetchedActivities.map((act) => {
      // Only mark as complete if we explicitly requested IDs (Detail View)
      // OR if it has a detailed polyline (strong indicator of detail view)
      const isComplete = !!requestedActivityIds || !!act.map?.polyline;
      return transformStravaActivity(act, isComplete);
    });

    if (includePhotos && requestedActivityIds) {
      // ... (photo logic remains same, omitting for brevity in thought but keeping in file)
      const photoFetchPromises = fetchedActivities.map(async (act) => {
        if (act.map?.polyline || act.map?.summary_polyline) {
          try {
            const activityPhotos: StravaPhoto[] = await client.getActivityPhotos(
              act.id,
            );

            return activityPhotos.map((photo) =>
              transformStravaPhoto(photo, athleteId),
            ).filter((photo): photo is Photo => photo !== null); // Filter out nulls
          } catch (error) {
            console.error(`Failed to fetch photos for activity ${act.id}:`, error);
            return []; // Return empty array on error for this activity
          }
        } else {
          return [];
        }
      });

      const photoResults = await Promise.all(photoFetchPromises);
      photos.push(...photoResults.flat());

      if (shouldDeletePhotos) {
        const activityIdsWithPhotos = fetchedActivities.map((act) => act.id);
        if (activityIdsWithPhotos.length > 0) {
          const existingPhotoRows = await db
            .select({
              photoId: photosSchema.unique_id,
              activityId: photosSchema.activity_id,
            })
            .from(photosSchema)
            .where(inArray(photosSchema.activity_id, activityIdsWithPhotos));

          const incomingPhotoIds = new Set(photos.map((photo) => photo.unique_id));
          const removedPhotos = existingPhotoRows.filter(
            ({ photoId }) => !incomingPhotoIds.has(photoId),
          );

          await db
            .delete(photosSchema)
            .where(inArray(photosSchema.activity_id, activityIdsWithPhotos));

          if (removedPhotos.length > 0) {
            await db
              .insert(photoDeletions)
              .values(
                removedPhotos.map(({ photoId, activityId }) => ({
                  athlete_id: athleteId,
                  photo_id: photoId,
                  activity_id: activityId,
                  deleted_at: new Date(),
                })),
              )
              .onConflictDoUpdate({
                target: [photoDeletions.athlete_id, photoDeletions.photo_id],
                set: {
                  activity_id: sql`excluded.activity_id`,
                  deleted_at: sql`excluded.deleted_at`,
                },
              });
          }
        }
      }
    }

    const dbActivities = activitiesToProcess.map((act) => ({
      ...act,
      athlete: athleteId,
    }));

    let savedActivities: Activity[] = [];

    if (dbActivities.length > 0) {
      // Prepare upsert values
      // We want to update everything that might have changed on Strava (name, stats, etc)
      // EXCEPT `is_complete` - we only want to set that to true if we actually fetched details.
      // If we represent a summary fetch, we should NOT overwrite `is_complete: true` with `false`.
      // However, the `transformStravaActivity` sets `is_complete` based on the fetch type.

      // Strategy:
      // Use onConflictDoUpdate.
      // We need to carefully construct the `set` clause to avoid downgrading data if possible,
      // though typically Strava summary data is "truth" for the things it contains.
      // The only risk is overwriting a detailed activity with a summary one and losing `is_complete` status.

      // Actually, if we are doing a summary fetch (`!requestedActivityIds`), checking existing is_complete status is expensive
      // if we do it one by one. But we can just use the DB's current value for `is_complete` if we are doing a summary fetch?
      // No, Drizzle doesn't support "use existing value" easily in `values`.

      // Simpler approach for now conforming to user request "upsert immediately":
      // Just upsert. If `is_complete` is calculated as false (summary fetch), we should ensure we don't accidentally set a true value to false.
      // But `transformStravaActivity` was modified to set `is_complete`.

      // Let's rely on the conflict target.

      const valuesToInsert = dbActivities.map(act => {
        // If we are definitely fetching details (requestedActivityIds is set), act.is_complete is true.
        // If we are summary fetching, act.is_complete is false.
        return act;
      });

      const savedStats = await db
        .insert(activitySchema)
        .values(valuesToInsert)
        .onConflictDoUpdate({
          target: activitySchema.id,
          set: {
            name: sql`excluded.name`,
            description: sql`COALESCE(excluded.description, ${activitySchema.description})`,
            distance: sql`excluded.distance`,
            moving_time: sql`excluded.moving_time`,
            elapsed_time: sql`excluded.elapsed_time`,
            total_elevation_gain: sql`excluded.total_elevation_gain`,
            sport_type: sql`excluded.sport_type`,
            start_date: sql`excluded.start_date`,
            start_date_local: sql`excluded.start_date_local`,
            timezone: sql`excluded.timezone`,
            map_summary_polyline: sql`excluded.map_summary_polyline`, // Always safe to update summary
            map_polyline: sql`COALESCE(excluded.map_polyline, ${activitySchema.map_polyline})`,

            // Critical: is_complete
            // If excluded.is_complete is true, set it.
            // If excluded.is_complete is false (summary), keep existing is_complete (GREATEST logic works for booleans in some SQL but simpler: )
            // actually `is_complete` is boolean.
            // CASE WHEN excluded.is_complete THEN true ELSE activity.is_complete END
            is_complete: sql`CASE WHEN excluded.is_complete THEN true ELSE ${activitySchema.is_complete} END`,

            average_speed: sql`excluded.average_speed`,
            max_speed: sql`excluded.max_speed`,
            average_heartrate: sql`excluded.average_heartrate`,
            max_heartrate: sql`excluded.max_heartrate`,
            elev_high: sql`excluded.elev_high`,
            elev_low: sql`excluded.elev_low`,
            kilojoules: sql`excluded.kilojoules`,
            average_watts: sql`excluded.average_watts`,
            device_watts: sql`excluded.device_watts`,
            calories: sql`COALESCE(excluded.calories, ${activitySchema.calories})`,
            total_photo_count: sql`excluded.total_photo_count`,
            upload_id: sql`excluded.upload_id`,
            pr_count: sql`excluded.pr_count`,
            achievement_count: sql`excluded.achievement_count`,
            kudos_count: sql`excluded.kudos_count`,
            comment_count: sql`excluded.comment_count`,
            athlete_count: sql`excluded.athlete_count`,

            gear_id: sql`excluded.gear_id`,
            map_bbox: sql`excluded.map_bbox`
          }
        })
        .returning();

      savedActivities = savedStats;
    }




    if (photos.length > 0) {

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



      if (newPhotos.length > 0) {

        await db
          .insert(photosSchema)
          .values(newPhotos)
          .onConflictDoNothing();
      } else {

      }

    }

    return { activities: savedActivities, photos, notFoundIds };
  } catch (error) {
    console.error('Error in fetchStravaActivities:', error);
    return { activities: [], photos: [], notFoundIds };
  }
}
