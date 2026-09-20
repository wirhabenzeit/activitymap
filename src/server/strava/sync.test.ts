import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActivitiesRepository } from '~/server/repositories/activities';

import { updateIncompleteActivities } from './sync.ts';

/**
 * `updateIncompleteActivities`'s not-found/delete branch used to run a
 * top-level `db.delete(activities)` followed by a separate top-level
 * `db.insert(activityDeletions)` - the same non-atomic delete-then-tombstone
 * bug already fixed for the webhook path (#133) and for
 * `ActivitiesRepository.deleteManyForAthlete` itself (issue #120's review).
 * This regression proves the fix: the branch now *delegates* to that already
 * atomic, change-record-emitting repository method instead of duplicating
 * its transaction, so this test only needs to prove the delegation - the
 * transaction/rollback behavior itself is covered by
 * `~/server/repositories/activities.test.ts`.
 */
function fakeActivitiesRepo(
  overrides: Partial<ActivitiesRepository> = {},
): { repo: ActivitiesRepository; deleteCalls: { athleteId: number; ids: number[] }[] } {
  const deleteCalls: { athleteId: number; ids: number[] }[] = [];
  const repo: ActivitiesRepository = {
    findManyByAthlete: async () => [],
    findManyByIds: async () => [],
    findPageByAthlete: async () => [],
    deleteManyForAthlete: async (athleteId, ids) => {
      deleteCalls.push({ athleteId, ids });
      return ids;
    },
    upsertOne: async (activity) => activity,
    ...overrides,
  };
  return { repo, deleteCalls };
}

void test('updateIncompleteActivities delegates not-found activities to deleteManyForAthlete (one atomic delete+tombstone+change-record transaction)', async () => {
  const { repo, deleteCalls } = fakeActivitiesRepo();

  const updated = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: repo,
    findIncompleteActivityIds: async () => [1, 2, 3],
    fetchActivities: async () => ({
      activities: [{ id: 1 }, { id: 2 }] as never,
      photos: [],
      notFoundIds: [3],
    }),
  });

  assert.equal(updated, 2);
  assert.deepEqual(deleteCalls, [{ athleteId: 42, ids: [3] }]);
});

void test('updateIncompleteActivities does not call deleteManyForAthlete when nothing was reported not-found', async () => {
  const { repo, deleteCalls } = fakeActivitiesRepo();

  await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: repo,
    findIncompleteActivityIds: async () => [1],
    fetchActivities: async () => ({
      activities: [{ id: 1 }] as never,
      photos: [],
      notFoundIds: [],
    }),
  });

  assert.deepEqual(deleteCalls, []);
});

void test('updateIncompleteActivities returns 0 without calling fetchActivities when there is nothing incomplete', async () => {
  let fetchCalled = false;
  const { repo, deleteCalls } = fakeActivitiesRepo();

  const updated = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: repo,
    findIncompleteActivityIds: async () => [],
    fetchActivities: async () => {
      fetchCalled = true;
      return { activities: [], photos: [], notFoundIds: [] };
    },
  });

  assert.equal(updated, 0);
  assert.equal(fetchCalled, false);
  assert.deepEqual(deleteCalls, []);
});

void test('a deleteManyForAthlete rejection (e.g. a rolled-back change-record insert) is caught, not left unhandled', async () => {
  const { repo } = fakeActivitiesRepo({
    deleteManyForAthlete: async () => {
      throw new Error('simulated transaction rollback');
    },
  });

  // The not-found branch's own try/catch logs and continues rather than
  // failing the whole sync run for one athlete - this proves that still
  // holds now that the delete goes through a repository call that can
  // reject (a real database rolling back the whole transaction) instead of
  // the old inline delete, which never threw past a swallowed inner catch.
  const updated = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: repo,
    findIncompleteActivityIds: async () => [1],
    fetchActivities: async () => ({
      activities: [],
      photos: [],
      notFoundIds: [1],
    }),
  });

  assert.equal(updated, 0);
});
