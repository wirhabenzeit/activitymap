import assert from 'node:assert/strict';
import test from 'node:test';

import { activities, photos, syncChanges } from '~/server/db/schema';

import { createActivitiesRepository, type ActivitiesRepository } from './activities.ts';

type FakeCall = {
  method: 'select' | 'delete' | 'insertTombstone' | 'insertChange' | 'insertActivity';
  via: 'outer' | 'tx';
};

/**
 * A minimal stand-in for the drizzle `db`/`tx` handle, just deep enough to
 * exercise `deleteManyForAthlete`/`upsertOne`'s call shape. It does not
 * interpret `where` conditions or persist rows - it records which handle
 * (`outer`, i.e. directly on `database`, vs `tx`, i.e. inside
 * `database.transaction(...)`) each write went through, which is exactly the
 * property this regression guards: every write belonging to one logical
 * mutation - the activity delete/upsert, its tombstone, and its
 * `sync_change` record(s) - must all happen on `tx`, never on `outer`, so a
 * real database can roll all of them back together on failure.
 */
function buildFakeDb(opts: {
  photosForActivities?: { id: string; activityId: number }[];
  deletedRows?: { deletedId: number }[];
  upsertedRow?: Record<string, unknown>;
  failTombstoneInsert?: boolean;
  failChangeInsert?: boolean;
}) {
  const calls: FakeCall[] = [];
  const recordedChanges: Record<string, unknown>[] = [];

  function makeHandle(via: FakeCall['via']) {
    return {
      select(_columns?: unknown) {
        return {
          from(table: unknown) {
            return {
              where: async () => {
                calls.push({ method: 'select', via });
                if (table === photos) return opts.photosForActivities ?? [];
                return [];
              },
            };
          },
        };
      },
      delete(_table: unknown) {
        calls.push({ method: 'delete', via });
        return {
          where() {
            return { returning: async () => opts.deletedRows ?? [] };
          },
        };
      },
      insert(table: unknown) {
        if (table === syncChanges) {
          return {
            values(rows: Record<string, unknown>[]) {
              calls.push({ method: 'insertChange', via });
              return {
                returning: async () => {
                  if (opts.failChangeInsert) {
                    throw new Error('simulated change insert failure');
                  }
                  recordedChanges.push(...rows);
                  return rows;
                },
              };
            },
          };
        }
        if (table === activities) {
          calls.push({ method: 'insertActivity', via });
          return {
            values() {
              return {
                onConflictDoUpdate() {
                  return { returning: async () => [opts.upsertedRow] };
                },
              };
            },
          };
        }
        // activityDeletions tombstone insert.
        calls.push({ method: 'insertTombstone', via });
        return {
          values() {
            return {
              onConflictDoUpdate: async () => {
                if (opts.failTombstoneInsert) {
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

  return { db: fakeDb, calls, recordedChanges };
}

function repoWith(db: ReturnType<typeof buildFakeDb>['db']): ActivitiesRepository {
  return createActivitiesRepository(
    db as unknown as Parameters<typeof createActivitiesRepository>[0],
  );
}

void test('deleteManyForAthlete performs the delete, its tombstone insert, and its change record inside one transaction', async () => {
  const { db, calls, recordedChanges } = buildFakeDb({
    deletedRows: [{ deletedId: 1 }],
  });

  const result = await repoWith(db).deleteManyForAthlete(42, [1]);

  assert.deepEqual(result, [1]);
  // Every write must go through `tx` (i.e. inside `database.transaction`),
  // never directly on the outer `database` - that's what makes them atomic.
  assert.deepEqual(calls, [
    { method: 'select', via: 'tx' },
    { method: 'delete', via: 'tx' },
    { method: 'insertTombstone', via: 'tx' },
    { method: 'insertChange', via: 'tx' },
  ]);
  assert.deepEqual(recordedChanges, [
    { athleteId: 42, entityType: 'activity', entityId: '1', operation: 'delete' },
  ]);
});

void test('deleteManyForAthlete records a change entry for a photo cascade-deleted along with its activity', async () => {
  const { db, recordedChanges } = buildFakeDb({
    deletedRows: [{ deletedId: 1 }],
    photosForActivities: [{ id: 'photo-a', activityId: 1 }],
  });

  await repoWith(db).deleteManyForAthlete(42, [1]);

  assert.deepEqual(recordedChanges, [
    { athleteId: 42, entityType: 'activity', entityId: '1', operation: 'delete' },
    { athleteId: 42, entityType: 'photo', entityId: 'photo-a', operation: 'delete' },
  ]);
});

void test('deleteManyForAthlete does not record a change for a photo whose activity was not actually deleted', async () => {
  // `candidatePhotos` is queried for every requested id up front, before the
  // ownership-scoped delete runs; a photo belonging to an activity that
  // turned out not to belong to `athleteId` (so it was not deleted) must not
  // get a spurious delete record.
  const { db, recordedChanges } = buildFakeDb({
    deletedRows: [], // nothing actually belonged to this athlete
    photosForActivities: [{ id: 'photo-a', activityId: 1 }],
  });

  const result = await repoWith(db).deleteManyForAthlete(42, [1]);

  assert.deepEqual(result, []);
  assert.deepEqual(recordedChanges, []);
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
    failTombstoneInsert: true,
  });

  await assert.rejects(
    () => repoWith(db).deleteManyForAthlete(42, [1]),
    /simulated tombstone insert failure/,
  );

  // The change record must never have been attempted once the tombstone
  // insert failed - and everything that did happen stayed inside the
  // (failed) transaction, never on the outer, non-transactional `database`.
  assert.deepEqual(calls, [
    { method: 'select', via: 'tx' },
    { method: 'delete', via: 'tx' },
    { method: 'insertTombstone', via: 'tx' },
  ]);
});

void test('a failed change-record insert rejects and rolls back the deletion (mutation cannot commit without its change entry)', async () => {
  const { db } = buildFakeDb({
    deletedRows: [{ deletedId: 1 }],
    failChangeInsert: true,
  });

  await assert.rejects(
    () => repoWith(db).deleteManyForAthlete(42, [1]),
    /simulated change insert failure/,
  );
  // A real `database.transaction` rolls back every statement in this
  // callback - including the delete and tombstone insert that already ran -
  // when the callback throws, exactly as it does for the tombstone-failure
  // case above. This fake cannot re-assert "the row still exists" (it has
  // no persisted state), so the rejection itself is the property under test:
  // the repository never returns a deleted-id list without every deletion
  // also being durably recorded on the change feed.
});

void test('upsertOne performs the activity upsert and its change record inside one transaction', async () => {
  const upsertedRow = { id: 7, athlete: 42, name: 'Ride' };
  const { db, calls, recordedChanges } = buildFakeDb({ upsertedRow });

  const result = await repoWith(db).upsertOne(
    upsertedRow as unknown as Parameters<ActivitiesRepository['upsertOne']>[0],
  );

  assert.deepEqual(result, upsertedRow);
  assert.deepEqual(calls, [
    { method: 'insertActivity', via: 'tx' },
    { method: 'insertChange', via: 'tx' },
  ]);
  assert.deepEqual(recordedChanges, [
    { athleteId: 42, entityType: 'activity', entityId: '7', operation: 'upsert' },
  ]);
});

void test('a failed change-record insert rejects an upsert instead of committing the activity without a change entry', async () => {
  const upsertedRow = { id: 7, athlete: 42, name: 'Ride' };
  const { db } = buildFakeDb({ upsertedRow, failChangeInsert: true });

  await assert.rejects(
    () =>
      repoWith(db).upsertOne(
        upsertedRow as unknown as Parameters<ActivitiesRepository['upsertOne']>[0],
      ),
    /simulated change insert failure/,
  );
});
