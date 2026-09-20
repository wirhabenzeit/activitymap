import 'server-only';

import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import {
  syncChanges,
  type SyncChange,
  type SyncEntityType,
  type SyncOperation,
} from '~/server/db/schema';

type DrizzleDb = typeof defaultDb;
type TransactionCallback = Parameters<DrizzleDb['transaction']>[0];

/**
 * The handle drizzle passes into `database.transaction(async (tx) => ...)`.
 * Structurally it supports the same `insert`/`select`/... query builder
 * methods as `DrizzleDb`, which is all `record` below needs from it.
 */
export type Transaction = TransactionCallback extends (tx: infer T) => unknown
  ? T
  : never;

/** Anything a change record can be written through: the top-level `db`, or an already-open transaction. */
export type DbOrTx = DrizzleDb | Transaction;

export type NewSyncChange = {
  athleteId: number;
  entityType: SyncEntityType;
  /** `activities.id` (number) or `photos.unique_id` (string) - stored as `text` either way. */
  entityId: string | number;
  operation: SyncOperation;
  /** Defaults to `now()` at insert time; only ever overridden by tests. */
  changedAt?: Date;
};

/**
 * Repository boundary for the `sync_change` append-only feed (issue #122).
 * Application services and #123's future bootstrap/delta endpoints depend on
 * this interface rather than on Drizzle directly, the same pattern as
 * `~/server/repositories/activities.ts` and `~/server/repositories/photos.ts`,
 * so tests can exercise them against an in-memory fake instead of a live
 * database.
 *
 * `record` is the one method every mutation call site (the `activities`
 * repository, the Strava webhook processor, the periodic Strava sync) calls
 * from *inside its own transaction*, passing that transaction as `tx` - see
 * the `syncChanges` doc comment in `~/server/db/schema.ts` for why that
 * matters. The read methods (`findAfter`, `latestSequence`,
 * `isCursorRetained`) are for #123 and for tests; they always read through
 * the repository's own injected `database`.
 */
export interface ChangesRepository {
  /**
   * Insert one row per entry and return them in the same order, so a
   * mutation with several affected entities (e.g. an activity delete that
   * cascades to its photos) gets one change record per entity, all on one
   * transaction. A no-op (returns `[]`) for an empty `entries` array, so
   * call sites do not need to special-case "nothing changed" themselves.
   */
  record(entries: NewSyncChange[], tx?: DbOrTx): Promise<SyncChange[]>;

  /** Changes for `athleteId` strictly after `afterSequence`, oldest first, capped at `opts.limit`. */
  findAfter(
    athleteId: number,
    afterSequence: number,
    opts?: { limit?: number },
  ): Promise<SyncChange[]>;

  /** The current change-feed high-water mark for `athleteId`, or `0` if it has none yet. */
  latestSequence(athleteId: number): Promise<number>;

  /**
   * Whether a "changes after `sequence`" read for this cursor would be
   * complete, i.e. retention has not compacted away any row the client
   * hasn't seen yet. See the retention-policy doc comment on
   * `compactOlderThan` below for the invariant this relies on. This is the
   * cheap, well-defined query the plan doc's `409 sync_rebootstrap_required`
   * contract needs; #123 builds the actual response on top of it - this PR
   * only makes the check possible.
   */
  isCursorRetained(sequence: number): Promise<boolean>;

  /**
   * Delete change rows older than `cutoff`. Retention policy: a `sync_change`
   * row is only ever eligible for deletion once it is older than the
   * retention window (see `DEFAULT_RETENTION_DAYS`), and compaction always
   * removes the oldest surviving rows first (a contiguous prefix by
   * `sequence`), never an arbitrary subset. That invariant is what makes
   * `isCursorRetained`'s single `MIN(sequence)` check sufficient: if a row
   * survives, every row after it survives too.
   *
   * Nothing in this codebase calls this yet - no scheduled job exists in
   * this PR (see the PR description's retention-policy section). It is
   * exposed now so a future job (#125's reconciliation worker is a natural
   * home for it) has a safe, tested primitive to call rather than writing
   * its own ad hoc `DELETE`.
   */
  compactOlderThan(cutoff: Date): Promise<number>;
}

/**
 * Conservative default retention window. `sync_change` rows are small and
 * cheap to keep; the cost of retaining "too long" is a bit of table size,
 * while the cost of retaining "too short" is a client with a stale cursor
 * being wrongly told to lose data instead of getting a clean
 * `409 sync_rebootstrap_required` rebootstrap prompt. 90 days comfortably
 * exceeds any plausible offline duration for a mobile client.
 */
export const DEFAULT_RETENTION_DAYS = 90;

export function createChangesRepository(
  database: DrizzleDb = defaultDb,
): ChangesRepository {
  return {
    async record(entries, tx) {
      if (entries.length === 0) return [];
      const handle = tx ?? database;
      return handle
        .insert(syncChanges)
        .values(
          entries.map((entry) => ({
            athleteId: entry.athleteId,
            entityType: entry.entityType,
            entityId: String(entry.entityId),
            operation: entry.operation,
            ...(entry.changedAt ? { changedAt: entry.changedAt } : {}),
          })),
        )
        .returning();
    },

    async findAfter(athleteId, afterSequence, { limit = 500 } = {}) {
      return database
        .select()
        .from(syncChanges)
        .where(
          and(
            eq(syncChanges.athleteId, athleteId),
            gt(syncChanges.sequence, afterSequence),
          ),
        )
        .orderBy(asc(syncChanges.sequence))
        .limit(limit);
    },

    async latestSequence(athleteId) {
      const [row] = await database
        .select({ max: sql<number | null>`max(${syncChanges.sequence})` })
        .from(syncChanges)
        .where(eq(syncChanges.athleteId, athleteId));
      return row?.max ?? 0;
    },

    async isCursorRetained(sequence) {
      // `0` ("nothing applied yet") is always a valid starting cursor,
      // regardless of what retention has compacted away.
      if (sequence <= 0) return true;

      const [row] = await database
        .select({ min: sql<number | null>`min(${syncChanges.sequence})` })
        .from(syncChanges);
      const oldestRetained = row?.min ?? null;

      // No rows at all: nothing has ever been recorded, so there is nothing
      // a cursor could have missed.
      if (oldestRetained === null) return true;

      // Valid iff nothing between `sequence + 1` and the oldest surviving
      // row was compacted away - i.e. the cursor is at or after the oldest
      // row compaction has left in place (see `compactOlderThan`'s
      // contiguous-prefix invariant).
      return sequence >= oldestRetained - 1;
    },

    async compactOlderThan(cutoff) {
      const deleted = await database
        .delete(syncChanges)
        .where(lt(syncChanges.changedAt, cutoff))
        .returning({ sequence: syncChanges.sequence });
      return deleted.length;
    },
  };
}

/** Default, database-backed repository used by application services. */
export const changesRepository = createChangesRepository();
