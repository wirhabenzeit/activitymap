import 'server-only';

import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import {
  activities,
  activityDeletions,
  photos,
  type Activity,
} from '~/server/db/schema';
import { createChangesRepository } from '~/server/repositories/changes';

type DrizzleDb = typeof defaultDb;

/**
 * Repository boundary for the `activities` table (and the deletion
 * tombstones that accompany it). Application services depend on this
 * interface rather than on Drizzle directly, which is what lets the
 * ownership tests in `~/server/application/activities.test.ts` exercise
 * authorization logic against an in-memory fake instead of a real database.
 */
export interface ActivitiesRepository {
  findManyByAthlete(
    athleteId: number,
    opts?: { limit?: number; offset?: number },
  ): Promise<Activity[]>;
  findManyByIds(ids: number[]): Promise<Activity[]>;
  /**
   * A stable keyset page of `athleteId`'s activities ordered by `id`
   * ascending, strictly after `afterId` (default `0`, i.e. the beginning).
   * Used by `/api/v1/sync/bootstrap` (issue #123), which must never use
   * offset pagination - `id` is immutable and monotonically assigned by
   * Strava, so a page boundary here is stable even as rows are inserted or
   * deleted elsewhere in the table.
   */
  findPageByAthlete(
    athleteId: number,
    opts: { afterId?: number; limit: number },
  ): Promise<Activity[]>;
  /** Deletes only the rows that belong to `athleteId`; returns the deleted ids. */
  deleteManyForAthlete(athleteId: number, ids: number[]): Promise<number[]>;
  upsertOne(activity: Activity): Promise<Activity>;
}

export function createActivitiesRepository(
  database: DrizzleDb = defaultDb,
): ActivitiesRepository {
  const changesRepo = createChangesRepository(database);

  return {
    async findManyByAthlete(athleteId, { limit = 10000, offset = 0 } = {}) {
      return database
        .select()
        .from(activities)
        .where(eq(activities.athlete, athleteId))
        .orderBy(desc(activities.start_date))
        .limit(limit)
        .offset(offset);
    },

    async findManyByIds(ids) {
      if (ids.length === 0) return [];
      return database
        .select()
        .from(activities)
        .where(inArray(activities.id, ids))
        .orderBy(desc(activities.start_date));
    },

    async findPageByAthlete(athleteId, { afterId = 0, limit }) {
      return database
        .select()
        .from(activities)
        .where(
          and(eq(activities.athlete, athleteId), gt(activities.id, afterId)),
        )
        .orderBy(asc(activities.id))
        .limit(limit);
    },

    async deleteManyForAthlete(athleteId, ids) {
      if (ids.length === 0) return [];

      // The delete, its tombstone, and its change-feed entries must commit
      // together: if any insert failed after the delete had already
      // committed separately, a retry would find nothing left to delete and
      // silently skip the tombstone (and the change record) forever - the
      // same lost-deletion failure mode fixed for the webhook path in #133.
      // See the review on issue #120 (tombstone) and issue #122 (change feed).
      return database.transaction(async (tx) => {
        // `photos.activity_id` cascades on delete (see the schema), so
        // deleting these activities silently deletes their photos too.
        // Read which photos that will affect *before* the delete so the
        // change feed can record those cascaded photo deletions as well -
        // otherwise they would vanish with no observable change record at
        // all, which the sync protocol cannot tell apart from "never
        // existed".
        const candidatePhotos = await tx
          .select({ id: photos.unique_id, activityId: photos.activity_id })
          .from(photos)
          .where(inArray(photos.activity_id, ids));

        const deleted = await tx
          .delete(activities)
          .where(
            and(eq(activities.athlete, athleteId), inArray(activities.id, ids)),
          )
          .returning({ deletedId: activities.id });

        if (deleted.length > 0) {
          await tx
            .insert(activityDeletions)
            .values(
              deleted.map(({ deletedId }) => ({
                athlete_id: athleteId,
                activity_id: deletedId,
                deleted_at: new Date(),
              })),
            )
            .onConflictDoUpdate({
              target: [activityDeletions.athlete_id, activityDeletions.activity_id],
              set: { deleted_at: sql`excluded.deleted_at` },
            });

          const deletedIds = new Set(deleted.map((row) => row.deletedId));
          const cascadedPhotoDeletes = candidatePhotos.filter((photo) =>
            deletedIds.has(photo.activityId),
          );

          await changesRepo.record(
            [
              ...deleted.map(({ deletedId }) => ({
                athleteId,
                entityType: 'activity' as const,
                entityId: deletedId,
                operation: 'delete' as const,
              })),
              ...cascadedPhotoDeletes.map(({ id }) => ({
                athleteId,
                entityType: 'photo' as const,
                entityId: id,
                operation: 'delete' as const,
              })),
            ],
            tx,
          );
        }

        return deleted.map((row) => row.deletedId);
      });
    },

    async upsertOne(activity) {
      return database.transaction(async (tx) => {
        const [saved] = await tx
          .insert(activities)
          .values(activity)
          .onConflictDoUpdate({ target: activities.id, set: activity })
          .returning();
        if (!saved) {
          throw new Error('Failed to upsert activity');
        }

        await changesRepo.record(
          [
            {
              athleteId: saved.athlete,
              entityType: 'activity',
              entityId: saved.id,
              operation: 'upsert',
            },
          ],
          tx,
        );

        return saved;
      });
    },
  };
}

/** Default, database-backed repository used by application services. */
export const activitiesRepository = createActivitiesRepository();
