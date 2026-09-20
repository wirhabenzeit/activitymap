import assert from 'node:assert/strict';
import test from 'node:test';

import { createActivitiesRepository, type ActivitiesRepository } from './activities.ts';

type FakeCall = { method: 'delete' | 'insert'; via: 'outer' | 'tx' };

/**
 * A minimal stand-in for the drizzle `db`/`tx` handle, just deep enough to
 * exercise `deleteManyForAthlete`'s call shape. It does not interpret `where`
 * conditions or persist rows - it only records which handle (`outer`, i.e.
 * directly on `database`, vs `tx`, i.e. inside `database.transaction(...)`)
 * each write went through, which is exactly the property this regression
 * guards: the delete and its tombstone insert must both happen on `tx`, never
 * on `outer`, so a real database can roll both back together on failure.
 */
function buildFakeDb(opts: {
  deletedRows: { deletedId: number }[];
  failInsert?: boolean;
}) {
  const calls: FakeCall[] = [];

  function makeHandle(via: FakeCall['via']) {
    return {
      delete() {
        calls.push({ method: 'delete', via });
        return {
          where() {
            return { returning: async () => opts.deletedRows };
          },
        };
      },
      insert() {
        calls.push({ method: 'insert', via });
        return {
          values() {
            return {
              onConflictDoUpdate: async () => {
                if (opts.failInsert) {
                  throw new Error('simulated tombstone insert failure');
                }
              },
            };
          },
        };
      },
    };
  }

  const outerHandle = makeHandle('outer');
  const fakeDb = {
    ...outerHandle,
    async transaction<T>(cb: (tx: ReturnType<typeof makeHandle>) => Promise<T>) {
      // A real transaction only applies its writes if `cb` resolves; since
      // this fake has no persisted state to roll back, the important
      // assertion lives in `calls` (everything went through `tx`, not
      // `outer`) rather than in any row surviving here.
      return cb(makeHandle('tx'));
    },
  };

  return { db: fakeDb, calls };
}

function repoWith(db: ReturnType<typeof buildFakeDb>['db']): ActivitiesRepository {
  return createActivitiesRepository(
    db as unknown as Parameters<typeof createActivitiesRepository>[0],
  );
}

void test('deleteManyForAthlete performs the delete and its tombstone insert inside one transaction', async () => {
  const { db, calls } = buildFakeDb({ deletedRows: [{ deletedId: 1 }] });

  const result = await repoWith(db).deleteManyForAthlete(42, [1]);

  assert.deepEqual(result, [1]);
  // Both writes must go through `tx` (i.e. inside `database.transaction`),
  // never directly on the outer `database` - that's what makes them atomic.
  assert.deepEqual(calls, [
    { method: 'delete', via: 'tx' },
    { method: 'insert', via: 'tx' },
  ]);
});

void test('a failed tombstone insert rejects instead of leaving a silent, untombstoned deletion', async () => {
  // Regression for the finding on issue #120: before this fix, the delete
  // and the tombstone insert were two independent top-level statements, so
  // a failing insert here would already have permanently removed the
  // activity with no tombstone recorded, and a retry would delete zero rows
  // and skip the tombstone forever. Wrapping both in `database.transaction`
  // means a real database rolls the delete back together with the failed
  // insert, so the caller sees a clean rejection instead of a torn write.
  const { db, calls } = buildFakeDb({
    deletedRows: [{ deletedId: 1 }],
    failInsert: true,
  });

  await assert.rejects(
    () => repoWith(db).deleteManyForAthlete(42, [1]),
    /simulated tombstone insert failure/,
  );

  // The delete only ever happened inside the (failed) transaction scope -
  // never on the outer, non-transactional `database` - so it was never
  // durably committed on its own.
  assert.deepEqual(calls, [
    { method: 'delete', via: 'tx' },
    { method: 'insert', via: 'tx' },
  ]);
});
