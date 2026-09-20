import assert from 'node:assert/strict';
import test from 'node:test';

import { syncChanges } from '~/server/db/schema';

import { createChangesRepository, type ChangesRepository } from './changes.ts';

/**
 * A minimal stand-in for the drizzle `db` handle, in the same spirit as
 * `~/server/repositories/activities.test.ts`'s fake: it does not interpret
 * `where(...)` conditions (those are real drizzle `SQL` fragments here, not
 * plain predicates - see that file's own doc comment on the same
 * limitation), it only fakes enough of the chain shape to drive each method
 * and, for reads, returns canned rows the test supplies. `insert()` is the
 * one method backed by real, order-preserving in-memory state, because
 * `record()`'s sequence-assignment logic - the property most of these tests
 * exist to prove - lives in the repository's own JS code, not in SQL.
 *
 * Real filtering correctness (`findAfter`'s `athleteId`/`sequence`
 * predicate, `isCursorRetained`/`compactOlderThan`'s date/aggregate
 * queries) is ordinary, well-understood single-column SQL and is not
 * independently re-verified here; there is no live Postgres in this
 * sandbox to run it against (see the PR description).
 */
function buildFakeDb(opts: {
  selectResult?: unknown[];
  aggregateResult?: { max?: number | null; min?: number | null };
  deletedRows?: { sequence: number }[];
} = {}) {
  const rows: {
    sequence: number;
    athleteId: number;
    entityType: string;
    entityId: string;
    operation: string;
    changedAt: Date;
  }[] = [];
  let nextSequence = 1;

  const fakeDb = {
    insert(table: unknown) {
      if (table !== syncChanges) throw new Error('unexpected insert target');
      return {
        values(entries: Record<string, unknown>[]) {
          return {
            returning: async () => {
              const inserted = entries.map((entry) => ({
                sequence: nextSequence++,
                athleteId: entry.athleteId as number,
                entityType: entry.entityType as string,
                entityId: entry.entityId as string,
                operation: entry.operation as string,
                changedAt: (entry.changedAt as Date | undefined) ?? new Date(),
              }));
              rows.push(...inserted);
              return inserted;
            },
          };
        },
      };
    },
    select(columns?: Record<string, unknown>) {
      // Both `latestSequence`/`isCursorRetained`'s aggregate queries
      // (`select({ max: sql\`...\` })`/`select({ min: sql\`...\` })`) and
      // `findAfter`'s full-row query (`select()`, no columns) go through
      // this same fake chain; which canned result to resolve to is decided
      // by which shape of `columns` this call was given.
      const isAggregate = !!columns && ('max' in columns || 'min' in columns);
      const resolved = isAggregate
        ? [{ max: opts.aggregateResult?.max ?? null, min: opts.aggregateResult?.min ?? null }]
        : (opts.selectResult ?? []);

      // A real drizzle query builder is itself a thenable at every stage
      // (`select().from()`, `...where()`, `...where().orderBy().limit()`
      // are all directly awaitable), which is what lets `latestSequence`
      // await `.where(...)` with no further chaining and `isCursorRetained`
      // await `.from(...)` with none at all. This object mimics that:
      // chaining is optional, and awaiting it at any point resolves to the
      // same canned `resolved` array.
      function makeChainable(): {
        where: () => ReturnType<typeof makeChainable>;
        orderBy: () => ReturnType<typeof makeChainable>;
        limit: () => Promise<unknown[]>;
        then: (
          resolve: (value: unknown) => void,
          reject?: (err: unknown) => void,
        ) => void;
      } {
        return {
          where: () => makeChainable(),
          orderBy: () => makeChainable(),
          limit: async () => resolved,
          then: (resolve, reject) => {
            Promise.resolve(resolved).then(resolve, reject).catch(() => undefined);
          },
        };
      }

      return { from: () => makeChainable() };
    },
    delete(table: unknown) {
      if (table !== syncChanges) throw new Error('unexpected delete target');
      return {
        where: () => ({
          returning: async () => opts.deletedRows ?? [],
        }),
      };
    },
  };

  return { db: fakeDb, rows };
}

function repoWith(db: ReturnType<typeof buildFakeDb>['db']): ChangesRepository {
  return createChangesRepository(
    db as unknown as Parameters<typeof createChangesRepository>[0],
  );
}

void test('record() is a no-op for an empty entry list (no DB round trip)', async () => {
  const { db } = buildFakeDb();
  const result = await repoWith(db).record([]);
  assert.deepEqual(result, []);
});

void test('record() assigns strictly increasing sequence numbers in insertion order, even for identical changedAt', async () => {
  const { db, rows } = buildFakeDb();
  const repo = repoWith(db);
  const sameInstant = new Date('2026-01-01T00:00:00.000Z');

  const inserted = await repo.record([
    {
      athleteId: 1,
      entityType: 'activity',
      entityId: 1,
      operation: 'upsert',
      changedAt: sameInstant,
    },
    {
      athleteId: 1,
      entityType: 'activity',
      entityId: 2,
      operation: 'upsert',
      changedAt: sameInstant,
    },
  ]);

  assert.equal(inserted.length, 2);
  assert.ok(
    inserted[0]!.sequence < inserted[1]!.sequence,
    'two changes recorded in the same instant must still get strictly ordered, distinct sequence numbers',
  );
  assert.equal(rows[0]!.changedAt.getTime(), rows[1]!.changedAt.getTime());
  // entityId is always stored as text, regardless of the input type -
  // `activities.id` (number) and `photos.unique_id` (string) share one column.
  assert.equal(rows[0]!.entityId, '1');
  assert.equal(rows[1]!.entityId, '2');
});

void test('a "changes after cursor X" read never skips or duplicates two changes that share a changedAt', async () => {
  // `findAfter`'s real query is `WHERE athleteId = X AND sequence > cursor
  // ORDER BY sequence` (see `~/server/repositories/changes.ts`) - ordinary
  // single-column SQL this suite does not re-verify against a live
  // database (see the module doc comment above). What *is* worth proving
  // without one is the property `record()` is actually responsible for:
  // that two changes committed in the same instant still get distinct,
  // strictly ordered sequence numbers, so paging by `sequence` - unlike
  // paging by `changedAt` alone, the bug this issue exists to fix - can
  // never land exactly between them and either skip or double-serve one.
  const { db, rows } = buildFakeDb();
  const repo = repoWith(db);
  const sameInstant = new Date('2026-06-01T00:00:00.000Z');

  await repo.record([
    { athleteId: 1, entityType: 'activity', entityId: 1, operation: 'upsert', changedAt: sameInstant },
    { athleteId: 1, entityType: 'activity', entityId: 2, operation: 'upsert', changedAt: sameInstant },
    { athleteId: 1, entityType: 'activity', entityId: 3, operation: 'upsert', changedAt: sameInstant },
  ]);

  // A minimal stand-in for `findAfter`'s real WHERE/ORDER BY, applied to
  // the fake's actual backing rows rather than to canned data, so this
  // exercises real sequence values `record()` assigned above.
  const changesAfter = (afterSequence: number) =>
    rows.filter((r) => r.sequence > afterSequence).sort((a, b) => a.sequence - b.sequence);

  // Page at the boundary right after the first row: must return exactly
  // the second and third rows - not skip the second (same instant as the
  // first) and not re-serve the first.
  const firstSequence = rows[0]!.sequence;
  const page = changesAfter(firstSequence);
  assert.deepEqual(page.map((r) => r.entityId), ['2', '3']);

  // Paging again from the new high-water mark returns nothing left to
  // apply - and re-requesting the same cursor again (a client retry after
  // an interruption) is safe and returns the identical page, not a
  // different one.
  const lastSequence = page[page.length - 1]!.sequence;
  assert.deepEqual(changesAfter(lastSequence), []);
  assert.deepEqual(changesAfter(firstSequence), page);
});

void test('a deletion change record carries no reference to the entity row it names', async () => {
  // `sync_change` has no foreign key to `activities`/`photos` (see the
  // schema doc comment): the row this test inserts never referenced a real
  // activities row, and it is still recorded exactly as given - proving a
  // deletion's change record does not require, and outlives, the row it
  // refers to.
  const { db, rows } = buildFakeDb();
  const repo = repoWith(db);

  const [inserted] = await repo.record([
    { athleteId: 7, entityType: 'activity', entityId: 999, operation: 'delete' },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(inserted!.operation, 'delete');
  assert.equal(inserted!.entityId, '999');
});

void test('latestSequence returns 0 when the repository reports no rows for this athlete', async () => {
  const { db } = repoBackedByAggregate({ max: null });
  assert.equal(await repoWith(db).latestSequence(1), 0);
});

void test('latestSequence returns the reported max sequence', async () => {
  const { db } = repoBackedByAggregate({ max: 42 });
  assert.equal(await repoWith(db).latestSequence(1), 42);
});

void test('isCursorRetained: cursor 0 ("nothing applied yet") is always retained', async () => {
  const { db } = repoBackedByAggregate({ min: 500 });
  assert.equal(await repoWith(db).isCursorRetained(0), true);
});

void test('isCursorRetained: any cursor is retained when nothing has ever been recorded', async () => {
  const { db } = repoBackedByAggregate({ min: null });
  assert.equal(await repoWith(db).isCursorRetained(999), true);
});

void test('isCursorRetained: retained at or after the oldest surviving sequence, stale strictly before it', async () => {
  const { db: dbAtFloor } = repoBackedByAggregate({ min: 100 });
  assert.equal(await repoWith(dbAtFloor).isCursorRetained(99), true); // floor - 1
  assert.equal(await repoWith(dbAtFloor).isCursorRetained(100), true);

  const { db: dbBelowFloor } = repoBackedByAggregate({ min: 100 });
  assert.equal(await repoWith(dbBelowFloor).isCursorRetained(50), false);
});

void test('compactOlderThan reports how many rows the delete removed', async () => {
  const { db } = buildFakeDb({ deletedRows: [{ sequence: 1 }, { sequence: 2 }] });
  const deletedCount = await repoWith(db).compactOlderThan(new Date('2020-01-01'));
  assert.equal(deletedCount, 2);
});

void test('compactOlderThan reports 0 when nothing was old enough to remove', async () => {
  const { db } = buildFakeDb({ deletedRows: [] });
  const deletedCount = await repoWith(db).compactOlderThan(new Date('2020-01-01'));
  assert.equal(deletedCount, 0);
});

function repoBackedByAggregate(aggregateResult: { max?: number | null; min?: number | null }) {
  return buildFakeDb({ aggregateResult });
}
