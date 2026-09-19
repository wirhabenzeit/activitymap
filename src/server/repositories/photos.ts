import 'server-only';

import { inArray } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import { photos, type Photo } from '~/server/db/schema';

type DrizzleDb = typeof defaultDb;

export interface PhotosRepository {
  findManyByAthlete(athleteId: number): Promise<Photo[]>;
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
  };
}

/** Default, database-backed repository used by application services. */
export const photosRepository = createPhotosRepository();
