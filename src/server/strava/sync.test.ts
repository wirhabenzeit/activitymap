import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActivitiesRepository } from '~/server/repositories/activities';
import type { DetailFailureCode } from './ingestion-policy.ts';
import { StravaApiError } from './client.ts';
import { StravaBudgetExceededError } from './request-budget.ts';
import { StravaPersistenceError } from './service.ts';

import {
  combineSteps,
  syncUser,
  updateIncompleteActivities,
  type SyncUserDeps,
} from './sync.ts';

/**
 * `updateIncompleteActivities`'s not-found/delete branch used to run a
 * top-level `db.delete(activities)` followed by a separate top-level
 * `db.insert(activityDeletions)` - the same non-atomic delete-then-tombstone
 * bug already fixed for the webhook path (#133) and for
 * `ActivitiesRepository.deleteManyForAthlete` itself (issue #120's review).
 * These tests prove the branch *delegates* to that already atomic,
 * change-record-emitting repository method; the transaction itself is
 * covered by `~/server/repositories/activities.test.ts`.
 */
function fakeActivitiesRepo(overrides: Partial<ActivitiesRepository> = {}): {
  repo: ActivitiesRepository;
  deleteCalls: { athleteId: number; ids: number[] }[];
} {
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
    replaceExistingForAthlete: async (_athleteId, activity) => activity,
    ...overrides,
  };
  return { repo, deleteCalls };
}

function fakeIngestion(candidates: number[] = []) {
  const recorded: { activityId: number; code: DetailFailureCode }[] = [];
  const cleared: number[] = [];
  return {
    recorded,
    cleared,
    ingestion: {
      findDetailCandidates: async () => candidates,
      recordDetailFailures: async (
        failures: { activityId: number; code: DetailFailureCode }[],
      ) => {
        recorded.push(...failures);
      },
      clearDetailAttempts: async (ids: number[]) => {
        cleared.push(...ids);
      },
    },
  };
}

const fetched = (ids: number[]) => ids.map((id) => ({ id })) as never;

void test('not-found activities are delegated to deleteManyForAthlete (one atomic delete+tombstone+change-record transaction)', async () => {
  const { repo, deleteCalls } = fakeActivitiesRepo();
  const { ingestion, cleared } = fakeIngestion([1, 2, 3]);

  const result = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: repo,
    ingestion,
    fetchActivities: async () => ({
      activities: fetched([1, 2]),
      photos: [],
      notFoundIds: [3],
    }),
  });

  assert.equal(result.updated, 2);
  assert.equal(result.deleted, 1);
  assert.deepEqual(result.outcome, { outcome: 'succeeded', reason: null });
  assert.deepEqual(deleteCalls, [{ athleteId: 42, ids: [3] }]);
  assert.deepEqual(cleared, [1, 2]);
});

void test('nothing pending makes no Strava call and is a successful no-op', async () => {
  let fetchCalled = false;
  const { repo, deleteCalls } = fakeActivitiesRepo();

  const result = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: repo,
    ingestion: fakeIngestion([]).ingestion,
    fetchActivities: async () => {
      fetchCalled = true;
      return { activities: [], photos: [], notFoundIds: [] };
    },
  });

  assert.equal(result.updated, 0);
  assert.deepEqual(result.outcome, { outcome: 'succeeded', reason: null });
  assert.equal(fetchCalled, false);
  assert.deepEqual(deleteCalls, []);
});

void test('individual detail failures back off and make the batch partial, not a zero-work success', async () => {
  const { ingestion, recorded } = fakeIngestion([1, 2, 3]);

  const result = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: fakeActivitiesRepo().repo,
    ingestion,
    fetchActivities: async () => ({
      activities: fetched([1]),
      photos: [],
      notFoundIds: [],
      failedIds: [2, 3],
      failures: [
        { activityId: 2, error: new StravaApiError('bad gateway', 502) },
        { activityId: 3, error: new StravaApiError('forbidden', 403) },
      ],
    }),
  });

  assert.equal(result.updated, 1);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.outcome, {
    outcome: 'partial',
    reason: 'detail_failures',
  });
  assert.deepEqual(recorded, [
    { activityId: 2, code: 'upstream_error' },
    { activityId: 3, code: 'forbidden' },
  ]);
});

void test('a batch where every activity failed is failed', async () => {
  const result = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: fakeActivitiesRepo().repo,
    ingestion: fakeIngestion([1]).ingestion,
    fetchActivities: async () => ({
      activities: [],
      photos: [],
      notFoundIds: [],
      failures: [{ activityId: 1, error: new Error('socket hang up') }],
    }),
  });

  assert.deepEqual(result.outcome, {
    outcome: 'failed',
    reason: 'detail_failures',
  });
});

void test('a rate limit defers the batch without blaming or backing off any activity', async () => {
  const { ingestion, recorded } = fakeIngestion([1, 2]);

  const result = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: fakeActivitiesRepo().repo,
    ingestion,
    fetchActivities: async () => ({
      activities: [],
      photos: [],
      notFoundIds: [],
      failures: [
        { activityId: 1, error: new StravaApiError('too many', 429) },
        { activityId: 2, error: new StravaBudgetExceededError(60) },
      ],
    }),
  });

  assert.deepEqual(result.outcome, {
    outcome: 'deferred',
    reason: 'rate_limited',
  });
  assert.deepEqual(recorded, []);
});

void test('rejected credentials block the account instead of failing activities', async () => {
  const { ingestion, recorded } = fakeIngestion([1]);

  const result = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: fakeActivitiesRepo().repo,
    ingestion,
    fetchActivities: async () => ({
      activities: [],
      photos: [],
      notFoundIds: [],
      failures: [{ activityId: 1, error: new StravaApiError('no', 401) }],
    }),
  });

  assert.deepEqual(result.outcome, {
    outcome: 'blocked',
    reason: 'unauthorized',
  });
  assert.deepEqual(recorded, []);
});

void test('a persistence failure is reported instead of returning zero work', async () => {
  const result = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: fakeActivitiesRepo().repo,
    ingestion: fakeIngestion([1]).ingestion,
    fetchActivities: async () => {
      throw new StravaPersistenceError({ cause: new Error('rollback') });
    },
  });

  assert.equal(result.updated, 0);
  assert.deepEqual(result.outcome, {
    outcome: 'failed',
    reason: 'persistence_failed',
  });
});

void test('a deleteManyForAthlete rejection is caught and reported, not left unhandled', async () => {
  const { repo } = fakeActivitiesRepo({
    deleteManyForAthlete: async () => {
      throw new Error('simulated transaction rollback');
    },
  });

  const result = await updateIncompleteActivities(42, 'token', 10, {
    activitiesRepo: repo,
    ingestion: fakeIngestion([1]).ingestion,
    fetchActivities: async () => ({
      activities: [],
      photos: [],
      notFoundIds: [1],
    }),
  });

  assert.equal(result.updated, 0);
  assert.equal(result.deleted, 0);
  assert.deepEqual(result.outcome, {
    outcome: 'failed',
    reason: 'persistence_failed',
  });
});

void test('combineSteps: credentials dominate, failures with other progress are partial', () => {
  assert.deepEqual(combineSteps([]), { outcome: 'succeeded', reason: null });
  assert.deepEqual(
    combineSteps([
      { outcome: 'succeeded', reason: null, committed: 3 },
      { outcome: 'failed', reason: 'history_fetch_failed', committed: 0 },
    ]),
    { outcome: 'partial', reason: 'history_fetch_failed' },
  );
  assert.deepEqual(
    combineSteps([
      { outcome: 'succeeded', reason: null, committed: 0 },
      { outcome: 'failed', reason: 'upstream_error', committed: 0 },
    ]),
    { outcome: 'failed', reason: 'upstream_error' },
  );
  assert.deepEqual(
    combineSteps([
      { outcome: 'partial', reason: 'photo_refresh_failed', committed: 1 },
      { outcome: 'blocked', reason: 'unauthorized', committed: 0 },
    ]),
    { outcome: 'blocked', reason: 'unauthorized' },
  );
  assert.deepEqual(
    combineSteps([
      { outcome: 'succeeded', reason: null, committed: 1 },
      { outcome: 'deferred', reason: 'rate_limited', committed: 0 },
    ]),
    { outcome: 'deferred', reason: 'rate_limited' },
  );
});

const USER = { id: 'user-1', athlete_id: 42, oldest_activity_reached: false };
const QUOTA = { incomplete: 10, older: 10, minActivitiesThreshold: 2 };

function userDeps(overrides: Partial<SyncUserDeps> = {}): SyncUserDeps {
  return {
    resolveAccessToken: async () => 'token',
    activitiesRepo: fakeActivitiesRepo().repo,
    ingestion: fakeIngestion([]).ingestion,
    findMostRecentActivityId: async () => 7,
    findOldestStartDate: async () => new Date('2020-01-01T00:00:00Z'),
    fetchActivities: async () => ({
      activities: fetched([7]),
      photos: [],
      notFoundIds: [],
    }),
    ...overrides,
  };
}

void test('syncUser blocks without calling Strava when no credential resolves', async () => {
  let calls = 0;
  const result = await syncUser(
    USER,
    QUOTA,
    userDeps({
      resolveAccessToken: async () => null,
      fetchActivities: async () => {
        calls += 1;
        return { activities: [], photos: [], notFoundIds: [] };
      },
    }),
  );
  assert.deepEqual(result.outcome, {
    outcome: 'blocked',
    reason: 'credentials_unavailable',
  });
  assert.equal(calls, 0);
});

void test('syncUser reports a photo-only failure as partial', async () => {
  const result = await syncUser(
    { ...USER, oldest_activity_reached: true },
    QUOTA,
    userDeps({
      fetchActivities: async () => ({
        activities: fetched([7]),
        photos: [],
        notFoundIds: [],
        photoRefreshFailedIds: [7],
      }),
    }),
  );
  assert.deepEqual(result.outcome, {
    outcome: 'partial',
    reason: 'photo_refresh_failed',
  });
});

void test('syncUser reports a failed history page instead of a successful run', async () => {
  const result = await syncUser(
    USER,
    QUOTA,
    userDeps({
      fetchActivities: async (input) => {
        if (input.before) throw new StravaApiError('oops', 500);
        return { activities: fetched([7]), photos: [], notFoundIds: [] };
      },
    }),
  );
  assert.equal(result.fetchedOlder, 0);
  assert.equal(result.reachedOldest, false);
  assert.deepEqual(result.outcome, {
    outcome: 'partial',
    reason: 'history_fetch_failed',
  });
});

void test('syncUser stops after a rate limit instead of spending more requests', async () => {
  const requests: string[] = [];
  const result = await syncUser(
    USER,
    QUOTA,
    userDeps({
      ingestion: fakeIngestion([1]).ingestion,
      fetchActivities: async (input) => {
        requests.push(input.before ? 'older' : 'detail');
        return {
          activities: [],
          photos: [],
          notFoundIds: [],
          failures: [
            {
              activityId: input.activityIds?.[0] ?? 0,
              error: new StravaApiError('too many', 429),
            },
          ],
        };
      },
    }),
  );
  assert.deepEqual(requests, ['detail']);
  assert.deepEqual(result.outcome, {
    outcome: 'deferred',
    reason: 'rate_limited',
  });
});

void test('syncUser retains the global rate-limit stop after an earlier partial failure', async () => {
  const result = await syncUser(
    USER,
    QUOTA,
    userDeps({
      fetchActivities: async (input) => {
        if (input.before) throw new StravaApiError('too many', 429);
        return {
          activities: fetched([7]),
          photos: [],
          notFoundIds: [],
          photoRefreshFailedIds: [7],
        };
      },
    }),
  );
  assert.equal(result.outcome.outcome, 'partial');
  assert.equal(result.stoppedForRateLimit, true);
});

void test('detail enrichment bundles photos and reports their partial failure without retrying successful details', async () => {
  const { ingestion, cleared } = fakeIngestion([1]);
  const result = await updateIncompleteActivities(42, 'token', 1, {
    ingestion,
    activitiesRepo: fakeActivitiesRepo().repo,
    fetchActivities: async (input) => {
      assert.equal(input.includePhotos, true);
      assert.equal(input.shouldDeletePhotos, true);
      return {
        activities: fetched([1]),
        photos: [],
        notFoundIds: [],
        photoRefreshFailedIds: [1],
        photoRefreshFailures: [
          { activityId: 1, error: new StravaApiError('unavailable', 503) },
        ],
      };
    },
  });
  assert.deepEqual(cleared, [1]);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.outcome, {
    outcome: 'partial',
    reason: 'photo_refresh_failed',
  });
});

void test('photo rate limit during detail enrichment stops subsequent work', async () => {
  const result = await updateIncompleteActivities(42, 'token', 1, {
    ingestion: fakeIngestion([1]).ingestion,
    activitiesRepo: fakeActivitiesRepo().repo,
    fetchActivities: async () => ({
      activities: fetched([1]),
      photos: [],
      notFoundIds: [],
      photoRefreshFailedIds: [1],
      photoRefreshFailures: [
        { activityId: 1, error: new StravaApiError('limited', 429) },
      ],
    }),
  });
  assert.deepEqual(result.outcome, {
    outcome: 'deferred',
    reason: 'rate_limited',
  });
});

void test('rate-limited latest-activity photos stop detail and history fetching', async () => {
  let calls = 0;
  const result = await syncUser(
    { id: 'user', athlete_id: 42, oldest_activity_reached: false },
    { incomplete: 5, older: 5, minActivitiesThreshold: 2 },
    {
      resolveAccessToken: async () => 'token',
      findMostRecentActivityId: async () => 1,
      ingestion: fakeIngestion([2]).ingestion,
      fetchActivities: async () => {
        calls++;
        return {
          activities: fetched([1]),
          photos: [],
          notFoundIds: [],
          photoRefreshFailedIds: [1],
          photoRefreshFailures: [
            { activityId: 1, error: new StravaApiError('limited', 429) },
          ],
        };
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.stoppedForRateLimit, true);
  assert.deepEqual(result.outcome, {
    outcome: 'deferred',
    reason: 'rate_limited',
  });
});
