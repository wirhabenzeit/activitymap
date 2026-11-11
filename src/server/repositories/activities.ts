import type { Activity } from '~/server/db/schema';

/** Reads of an account's activities, as the sync routes need them. */
export interface ActivitiesRepository {
  /** Rows for the given ids, in no particular order; missing ids are omitted. */
  findManyByIds(ids: number[]): Promise<Activity[]>;
  /**
   * A stable keyset page of `athleteId`'s activities ordered by `id`
   * ascending, strictly after `afterId` (default `0`, the beginning). Never
   * offset pagination: `id` is immutable, so a page boundary is stable while
   * activities are added or removed.
   */
  findPageByAthlete(
    athleteId: number,
    opts: { afterId?: number; limit: number },
  ): Promise<Activity[]>;
}
