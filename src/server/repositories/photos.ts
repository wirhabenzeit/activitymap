import 'server-only';

import { and, asc, eq, gt, inArray } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import { photos, type Photo } from '~/server/db/schema';

type DrizzleDb = typeof defaultDb;

export interface PhotosRepository {
  findManyByAthlete(athleteId: number): Promise<Photo[]>;
  findManyByActivityForAthlete(
    athleteId: number,
    activityId: number,
  ): Promise<Photo[]>;
  /** Rows for the given `unique_id`s, in no particular order; missing ids are silently omitted. */
  findManyByIds(ids: string[]): Promise<Photo[]>;
  /**
   * A stable keyset page of `athleteId`'s photos ordered by `unique_id`
   * ascending, strictly after `afterId` (default `''`, i.e. the beginning).
   * Used by `/api/v1/sync/bootstrap` (issue #123) - see the equivalent
   * method on `~/server/repositories/activities.ts` for why this must be
   * keyset, never offset, pagination.
   */
  findPageByAthlete(
    athleteId: number,
    opts: { afterId?: string; limit: number },
  ): Promise<Photo[]>;
}

export function createPhotosRepository(
  database: DrizzleDb = defaultDb,
): PhotosRepository {
  return {
    async findManyByAthlete(athleteId) {
      return database
        .select()
        .from(photos)
        .where(inArray(photos.athlete_id, [athleteId]));
    },

    async findManyByActivityForAthlete(athleteId, activityId) {
      return database
        .select()
        .from(photos)
        .where(
          and(
            eq(photos.athlete_id, athleteId),
            eq(photos.activity_id, activityId),
          ),
        );
    },

    async findManyByIds(ids) {
      if (ids.length === 0) return [];
      return database
        .select()
        .from(photos)
        .where(inArray(photos.unique_id, ids));
    },

    async findPageByAthlete(athleteId, { afterId = '', limit }) {
      return database
        .select()
        .from(photos)
        .where(
          and(eq(photos.athlete_id, athleteId), gt(photos.unique_id, afterId)),
        )
        .orderBy(asc(photos.unique_id))
        .limit(limit);
    },
  };
}

/** Default, database-backed repository used by application services. */
export const photosRepository = createPhotosRepository();
