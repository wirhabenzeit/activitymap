import type { SyncChange } from '~/server/records';

/** An account's change feed: what the changes route pages through. */
export interface ChangesRepository {
  /** Changes with a sequence after `afterSequence`, oldest first. */
  findAfter(
    athleteId: number,
    afterSequence: number,
    opts?: { limit?: number },
  ): Promise<SyncChange[]>;
  /** The feed's high-water mark for `athleteId`, or `0` if it has none yet. */
  latestSequence(athleteId: number): Promise<number>;
}

/**
 * How long a change stays in the feed. A cursor older than this is refused,
 * and the client starts again from a bootstrap.
 */
export { SYNC_RETENTION_DAYS as DEFAULT_RETENTION_DAYS } from '~/contracts/v1/sync-policy';
