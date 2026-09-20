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
 * matters. The read methods (`findAfter`, `latestSequence`) are for #123
 * and for tests; they always read through the repository's own injected
 * `database`.
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
   * Delete change rows older than `cutoff`. Retention policy: a `sync_change`
   * row is only ever eligible for deletion once it is older than the
   * retention window (see `DEFAULT_RETENTION_DAYS`). The changes API embeds
   * the cursor's issuance time and rejects it at that same deadline before
   * reading this feed, including when compaction has removed every row.
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
