import { sql } from 'drizzle-orm';

/**
 * The writer fence (docs/convex-writer-cutover.md, decision 3).
 *
 * `user.writer` says which store ingests and writes an owner's library.
 * Database triggers (migration 0031) refuse inserts, updates and deletes on
 * the owner's activities, activity streams, photos, place results and place
 * checks unless it is `postgres`. The check is part of the writing
 * transaction, so it holds for every code path, including work that picked
 * its owner before a handoff:
 *
 * - each write takes a share lock on the owner's user row, so a handoff,
 *   which updates that row, waits until the transactions that have written
 *   for the owner are finished;
 * - a transaction that first writes after the handoff committed is refused,
 *   by the fence or, if its snapshot is older, as a serialization failure.
 *
 * Jobs should still skip owners they do not write for; the fence is what
 * makes a mistake there harmless.
 */

/** SQLSTATE raised by the fence. */
export const WRITER_FENCED_SQLSTATE = 'AMW01';

/** Whether an error, or one it wraps, is the fence refusing a write. */
export function isWriterFencedError(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === WRITER_FENCED_SQLSTATE)
      return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Let the current transaction write an owner's rows whoever the writer is.
 * Only for writes that are not ingestion: copying Convex's state back for an
 * owner Convex writes (the reverse mirror) and erasing an account. The
 * setting ends with the transaction; outside one it has no effect.
 */
export const bypassWriterFence = sql`SELECT set_config('activitymap.writer_fence', 'bypass', true)`;

/**
 * Move an owner to another writer if it is still at `expectedEpoch`.
 * Returns the new epoch, or null when the epoch has moved on (someone else
 * handed the owner off). Waits for in-flight writes for the owner.
 */
export const setWriter = (
  userId: string,
  writer: 'postgres' | 'handoff' | 'convex',
  expectedEpoch: number,
) => sql`
  UPDATE "user" SET writer = ${writer}, writer_epoch = writer_epoch + 1
  WHERE id = ${userId} AND writer_epoch = ${expectedEpoch}
  RETURNING writer_epoch`;
