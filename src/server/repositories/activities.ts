import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import { activities, activityDeletions, type Activity } from '~/server/db/schema';

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
  /** Deletes only the rows that belong to `athleteId`; returns the deleted ids. */
  deleteManyForAthlete(athleteId: number, ids: number[]): Promise<number[]>;
  upsertOne(activity: Activity): Promise<Activity>;
}

export function createActivitiesRepository(
  database: DrizzleDb = defaultDb,
): ActivitiesRepository {
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

    async deleteManyForAthlete(athleteId, ids) {
      if (ids.length === 0) return [];

      // The delete and its tombstone must commit together: if the tombstone
      // insert failed after the delete had already committed separately, a
      // retry would find nothing left to delete and silently skip the
      // tombstone forever - the same lost-deletion failure mode fixed for
      // the webhook path in #133. See the review on issue #120.
      return database.transaction(async (tx) => {
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
        }

        return deleted.map((row) => row.deletedId);
      });
    },

    async upsertOne(activity) {
      const [saved] = await database
        .insert(activities)
        .values(activity)
        .onConflictDoUpdate({ target: activities.id, set: activity })
        .returning();
      if (!saved) {
        throw new Error('Failed to upsert activity');
      }
      return saved;
    },
  };
}

/** Default, database-backed repository used by application services. */
export const activitiesRepository = createActivitiesRepository();
