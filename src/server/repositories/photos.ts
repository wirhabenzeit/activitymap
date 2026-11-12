import type { Photo } from '~/server/records';

/** Reads of an account's photos, as the sync routes need them. */
export interface PhotosRepository {
  /** Rows for the given `unique_id`s, in no particular order; missing ids are omitted. */
  findManyByIds(ids: string[]): Promise<Photo[]>;
  /**
   * A stable keyset page of `athleteId`'s photos ordered by `unique_id`
   * ascending, strictly after `afterId` (default `''`, the beginning).
   */
  findPageByAthlete(
    athleteId: number,
    opts: { afterId?: string; limit: number },
  ): Promise<Photo[]>;
}
