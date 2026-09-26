import 'server-only';

import {
  activities as activitySchema,
  photoDeletions,
  photos as photosSchema,
  type Activity,
  type Photo,
} from '~/server/db/schema';

import { db } from '~/server/db';
import { logger } from '~/server/logging/logger';
import {
  isStravaActivityNotFoundError,
  StravaClient,
} from './client';
import { transformStravaActivity, transformStravaPhoto } from './transforms';
import { type StravaPhoto } from './types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { StravaActivity } from './types';
import { fetchActivitiesSchema, type FetchActivitiesInput } from './validators';
import {
  createChangesRepository,
  type NewSyncChange,
} from '~/server/repositories/changes';

const changesRepo = createChangesRepository(db);
type ActivityPersistenceTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Run a refresh persistence callback only after locking every still-owned
 * target row. A delete committed before the lock makes the callback a no-op;
 * a delete that starts after the lock waits and wins after this commit.
 */
export async function withLockedExistingActivities<T>(
  database: Pick<typeof db, 'transaction'>,
  athleteId: number,
  activityIds: number[],
  persist: (tx: ActivityPersistenceTransaction) => Promise<T>,
): Promise<T | null> {
  return database.transaction(async (tx) => {
    const existing = await tx
      .select({ id: activitySchema.id })
      .from(activitySchema)
      .where(
        and(
          eq(activitySchema.athlete, athleteId),
          inArray(activitySchema.id, activityIds),
        ),
      )
      .for('update');
    if (existing.length !== activityIds.length) return null;
    return persist(tx);
  });
}

/**
 * Internal application service. This file intentionally has no 'use server'
 * directive: it accepts a caller-supplied Strava access token and athlete ID,
 * so it must only ever be invoked from trusted server-side code (webhook
 * processing, scheduled sync, or a Server Action that has already resolved
 * these values itself via getAuthenticatedAccountInternal/getAccountInternal).
 * It must never be exported from a 'use server' file, which would make it
 * directly network-callable with client-supplied credentials. See issue #116.
 */

/** Strava succeeded, but its response could not be committed locally. */
export class StravaPersistenceError extends Error {
  constructor(
    options: { cause: unknown },
    public readonly upstreamSucceeded = true,
  ) {
    super('The Strava response could not be persisted', options);
    this.name = 'StravaPersistenceError';
  }
}

export type FetchStravaActivitiesResult = {
  activities: Activity[];
  photos: Photo[];
  notFoundIds: number[];
  failedIds?: number[];
  /** Internal errors retained so single-activity callers can classify them. */
  failures?: Array<{ activityId: number; error: unknown }>;
  /** IDs whose returned photo sets are authoritative, including known-empty. */
  photoRefreshAuthoritativeIds?: number[];
  photoRefreshFailedIds?: number[];
  /** Internal errors retained so the application service can classify a partial refresh. */
  photoRefreshFailures?: Array<{ activityId: number; error: unknown }>;
};

type ActivityDetailClient = Pick<
  StravaClient,
  'getActivity' | 'getActivities' | 'getActivityPhotos'
>;

export type FetchStravaActivitiesDeps = {
  createClient?: (accessToken: string) => ActivityDetailClient;
};

export async function fetchRequestedStravaActivities(
  client: Pick<ActivityDetailClient, 'getActivity'>,
  activityIds: number[],
): Promise<{
  activities: StravaActivity[];
  notFoundIds: number[];
  failedIds: number[];
  failures: Array<{ activityId: number; error: unknown }>;
}> {
  const notFoundIds: number[] = [];
  const failedIds: number[] = [];
  const failures: Array<{ activityId: number; error: unknown }> = [];
  const results = await Promise.all(
    activityIds.map(async (id) => {
      try {
        return await client.getActivity(id);
      } catch (error: unknown) {
        if (isStravaActivityNotFoundError(error)) {
          logger.warn(
            `Activity ${id} explicitly reported missing by Strava. Marked for removal.`,
          );
          notFoundIds.push(id);
          return null;
        }
        logger.error('Failed to fetch individual activity:', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
        failedIds.push(id);
        failures.push({ activityId: id, error });
        return null;
      }
    }),
  );
  return {
    activities: results.filter(
      (activity): activity is StravaActivity => activity !== null,
    ),
    notFoundIds,
    failedIds,
    failures,
  };
}

export async function fetchStravaActivities(
  input: FetchActivitiesInput,
  deps: FetchStravaActivitiesDeps = {},
): Promise<FetchStravaActivitiesResult> {
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
    limit,
    persist,
    requireExisting,
  } = fetchActivitiesSchema.parse(input);

  // Token refresh is now handled outside this function
  const client = (deps.createClient ?? StravaClient.withAccessToken)(accessToken);
  const photos: Photo[] = [];
  let notFoundIds: number[] = [];
  let failedIds: number[] = [];
  let failures: Array<{ activityId: number; error: unknown }> = [];
  const photoRefreshFailed = new Set<number>();
  const photoRefreshFailures: Array<{ activityId: number; error: unknown }> =
    [];

  let stravaActivitiesResult: StravaActivity[];

  if (requestedActivityIds) {
    const requested = await fetchRequestedStravaActivities(
      client,
      requestedActivityIds,
    );
    stravaActivitiesResult = requested.activities;
    notFoundIds = requested.notFoundIds;
    failedIds = requested.failedIds;
    failures = requested.failures;
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

  const fetchedActivities = stravaActivitiesResult;

  if (!fetchedActivities || fetchedActivities.length === 0) {
    return {
      activities: [],
      photos: [],
      notFoundIds,
      failedIds,
      failures,
      photoRefreshAuthoritativeIds: [],
      photoRefreshFailedIds: [],
    };
  }

  const photoRefreshSucceeded = new Set<number>();
  if (includePhotos && requestedActivityIds) {
    // A detailed Strava response with both counts at zero is authoritative
    // without spending a second request. Explicit user refreshes still call
    // the photo endpoint so they can reconcile independently of count data.
    if (!requireExisting) {
      for (const activity of fetchedActivities) {
        if (
          activity.total_photo_count === 0 &&
          activity.photo_count === 0 &&
          !activity.map?.polyline &&
          !activity.map?.summary_polyline
        ) {
          photoRefreshSucceeded.add(activity.id);
        }
      }
    }
    const photoCandidates = fetchedActivities.filter(
      (activity) =>
        requireExisting ||
        !!activity.map?.polyline ||
        !!activity.map?.summary_polyline ||
        activity.total_photo_count > 0 ||
        activity.photo_count > 0,
    );
    const photoFetchPromises = photoCandidates.map(async (act) => {
      try {
        const activityPhotos: StravaPhoto[] = await client.getActivityPhotos(
          act.id,
        );
        photoRefreshSucceeded.add(act.id);

        return activityPhotos
          .map((photo) => transformStravaPhoto(photo, athleteId))
          .filter((photo): photo is Photo => photo !== null);
      } catch (error) {
        photoRefreshFailed.add(act.id);
        photoRefreshFailures.push({ activityId: act.id, error });
        logger.error(`Failed to fetch photos for activity ${act.id}:`, error);
        return [];
      }
    });

    const photoResults = await Promise.all(photoFetchPromises);
    photos.push(...photoResults.flat());
  }

  const activitiesToProcess = fetchedActivities.map((act) => {
    // Only mark as complete if we explicitly requested IDs (Detail View)
    // OR if it has a detailed polyline (strong indicator of detail view).
    const isComplete = !!requestedActivityIds || !!act.map?.polyline;
    return transformStravaActivity(act, isComplete, {
      photosCurrent: photoRefreshSucceeded.has(act.id),
    });
  });

  const dbActivities = activitiesToProcess.map((act) => ({
    ...act,
    athlete: athleteId,
  }));

  let savedActivities: Activity[] = dbActivities;
  const photosCurrentForRow =
    photoRefreshSucceeded.size > 0
      ? sql`excluded.id in (${sql.join(
          [...photoRefreshSucceeded].map((id) => sql`${id}`),
          sql.raw(', '),
        )})`
      : sql`false`;

  // `persist: false` (see `~/server/strava/validators.ts`) is used by the
  // webhook processor, which performs its own transactional
  // upsert/photo-replace and change-feed recording immediately after this
  // call returns. Without this flag that second write would duplicate
  // this one - non-transactionally, with no change record - and then be
  // immediately overwritten by it, which is exactly the kind of
  // non-atomic double write issue #122 exists to eliminate.
  if (persist) {
    try {
      const persistRows = async (tx: ActivityPersistenceTransaction) => {
        const changeEntries: NewSyncChange[] = [];

        // Handle photos: delete existing rows for the activities just
        // fetched, tombstone whichever of them are not present in the new
        // set, then (below) insert the new set. Deleting and re-inserting
        // - rather than diffing field by field - mirrors how Strava itself
        // treats an activity's photo set as replaced wholesale on refetch.
        let removedPhotoRows: { photoId: string; activityId: number }[] = [];
        if (shouldDeletePhotos) {
          // A failed photo request is non-authoritative. Preserve prior photo
          // rows and freshness for that activity rather than replacing them
          // with a synthetic empty set.
          const activityIdsWithPhotos = fetchedActivities
            .map((act) => act.id)
            .filter((id) => photoRefreshSucceeded.has(id));
          if (activityIdsWithPhotos.length > 0) {
            const existingPhotoRows = await tx
              .select({
                photoId: photosSchema.unique_id,
                activityId: photosSchema.activity_id,
              })
              .from(photosSchema)
              .where(inArray(photosSchema.activity_id, activityIdsWithPhotos));

            const incomingPhotoIds = new Set(
              photos.map((photo) => photo.unique_id),
            );
            removedPhotoRows = existingPhotoRows.filter(
              ({ photoId }) => !incomingPhotoIds.has(photoId),
            );

            await tx
              .delete(photosSchema)
              .where(inArray(photosSchema.activity_id, activityIdsWithPhotos));

            if (removedPhotoRows.length > 0) {
              await tx
                .insert(photoDeletions)
                .values(
                  removedPhotoRows.map(({ photoId, activityId }) => ({
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

              for (const { photoId } of removedPhotoRows) {
                changeEntries.push({
                  athleteId,
                  entityType: 'photo',
                  entityId: photoId,
                  operation: 'delete',
                });
              }
            }
          }
        }

        let savedStats: Activity[] = [];
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

          const valuesToInsert = dbActivities.map((act) => {
            // If we are definitely fetching details (requestedActivityIds is set), act.is_complete is true.
            // If we are summary fetching, act.is_complete is false.
            return act;
          });

          savedStats = await tx
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
                geometryState: sql`CASE WHEN excluded.is_complete THEN excluded.geometry_state ELSE COALESCE(${activitySchema.geometryState}, excluded.geometry_state) END`,
                photosState: sql`CASE WHEN ${photosCurrentForRow} THEN excluded.photos_state ELSE COALESCE(${activitySchema.photosState}, excluded.photos_state) END`,
                lastSummarySeenAt: sql`excluded.last_summary_seen_at`,
                lastDetailedFetchedAt: sql`COALESCE(excluded.last_detailed_fetched_at, ${activitySchema.lastDetailedFetchedAt})`,

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
                map_bbox: sql`excluded.map_bbox`,
                ...(requestedActivityIds
                  ? {
                      description: sql`excluded.description`,
                      start_latlng: sql`excluded.start_latlng`,
                      end_latlng: sql`excluded.end_latlng`,
                      photo_count: sql`excluded.photo_count`,
                      map_id: sql`excluded.map_id`,
                      map_polyline: sql`excluded.map_polyline`,
                      trainer: sql`excluded.trainer`,
                      commute: sql`excluded.commute`,
                      manual: sql`excluded.manual`,
                      private: sql`excluded.private`,
                      flagged: sql`excluded.flagged`,
                      workout_type: sql`excluded.workout_type`,
                      has_heartrate: sql`excluded.has_heartrate`,
                      max_heartrate: sql`excluded.max_heartrate`,
                      heartrate_opt_out: sql`excluded.heartrate_opt_out`,
                      display_hide_heartrate_option: sql`excluded.display_hide_heartrate_option`,
                      has_kudoed: sql`excluded.has_kudoed`,
                      hide_from_home: sql`excluded.hide_from_home`,
                      max_watts: sql`excluded.max_watts`,
                      weighted_average_watts: sql`excluded.weighted_average_watts`,
                      last_updated: sql`excluded.last_updated`,
                    }
                  : {}),
              },
            })
            .returning();

          for (const saved of savedStats) {
            changeEntries.push({
              athleteId,
              entityType: 'activity',
              entityId: saved.id,
              operation: 'upsert',
            });
          }
        }

        if (photos.length > 0) {
          const photoIds: string[] = photos
            .map((p) => p.unique_id)
            .filter((id): id is string => !!id);
          let existingPhotos: { uniqueId: string | null }[] = [];
          if (photoIds.length > 0) {
            existingPhotos = await tx
              .select({ uniqueId: photosSchema.unique_id })
              .from(photosSchema)
              .where(inArray(photosSchema.unique_id, photoIds));
          }

          const existingPhotoIds = new Set(
            existingPhotos.map((p) => p.uniqueId),
          );
          const newPhotos = photos.filter(
            (p) => p.unique_id && !existingPhotoIds.has(p.unique_id),
          );

          if (newPhotos.length > 0) {
            await tx
              .insert(photosSchema)
              .values(newPhotos)
              .onConflictDoNothing();

            for (const photo of newPhotos) {
              changeEntries.push({
                athleteId,
                entityType: 'photo',
                entityId: photo.unique_id,
                operation: 'upsert',
              });
            }
          }
        }

        // The change feed entry for every mutation this transaction just
        // made commits with it - never as a follow-up statement. See
        // issue #122.
        await changesRepo.record(changeEntries, tx);

        return dbActivities.length > 0 ? savedStats : dbActivities;
      };
      savedActivities = requireExisting
        ? ((await withLockedExistingActivities(
            db,
            athleteId,
            requestedActivityIds ?? [],
            persistRows,
          )) ?? [])
        : await db.transaction(persistRows);
    } catch (error) {
      throw new StravaPersistenceError({ cause: error });
    }
  }

  return {
    activities: savedActivities,
    photos,
    notFoundIds,
    failedIds,
    failures,
    photoRefreshAuthoritativeIds: [...photoRefreshSucceeded],
    photoRefreshFailedIds: [...photoRefreshFailed],
    photoRefreshFailures,
  };
}
