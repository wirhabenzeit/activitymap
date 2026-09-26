import assert from 'node:assert/strict';
import test from 'node:test';

import { StravaApiError } from './client';
import {
  fetchStravaActivities,
  withLockedExistingActivities,
} from './service';
import type { StravaActivity } from './types';

function stravaActivity(
  id: number,
  overrides: Partial<StravaActivity> = {},
): StravaActivity {
  return {
    id,
    resource_state: 3,
    athlete: { id: 42 } as StravaActivity['athlete'],
    name: `Activity ${id}`,
    description: null,
    distance: 1000,
    moving_time: 300,
    elapsed_time: 320,
    total_elevation_gain: 12,
    elev_high: null,
    elev_low: null,
    sport_type: 'Run',
    start_date: '2026-01-01T00:00:00.000Z',
    start_date_local: '2026-01-01T01:00:00.000Z',
    timezone: 'Europe/Zurich',
    start_latlng: null,
    end_latlng: null,
    achievement_count: 0,
    kudos_count: 0,
    comment_count: 0,
    athlete_count: 1,
    photo_count: 0,
    total_photo_count: 0,
    map: {
      id: `map-${id}`,
      polyline: null,
      summary_polyline: null,
      resource_state: 3,
    },
    trainer: false,
    commute: false,
    manual: false,
    private: false,
    flagged: false,
    workout_type: null,
    upload_id: null,
    average_speed: 3,
    max_speed: 4,
    has_kudoed: false,
    hide_from_home: false,
    gear_id: null,
    kilojoules: null,
    average_watts: null,
    device_watts: null,
    max_watts: null,
    weighted_average_watts: null,
    calories: null,
    device_name: null,
    pr_count: 0,
    ...overrides,
  };
}

function transactionDb(existingIds: number[]) {
  const calls: string[] = [];
  const tx = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async for(mode: string) {
                  calls.push(`lock:${mode}`);
                  return existingIds.map((id) => ({ id }));
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    calls,
    database: {
      async transaction<T>(callback: (handle: typeof tx) => Promise<T>) {
        calls.push('transaction');
        return callback(tx);
      },
    },
  };
}

void test('refresh persistence runs only after locking the still-owned row in its transaction', async () => {
  const present = transactionDb([7]);
  const persisted = await withLockedExistingActivities(
    present.database as never,
    42,
    [7],
    async () => {
      present.calls.push('persist');
      return 'saved';
    },
  );
  assert.equal(persisted, 'saved');
  assert.deepEqual(present.calls, ['transaction', 'lock:update', 'persist']);

  const deletedBeforeLock = transactionDb([]);
  const superseded = await withLockedExistingActivities(
    deletedBeforeLock.database as never,
    42,
    [7],
    async () => {
      throw new Error('a late upstream response must not recreate the row');
    },
  );
  assert.equal(superseded, null);
  assert.deepEqual(deletedBeforeLock.calls, ['transaction', 'lock:update']);
});

void test('multi-ID detail fetch retains partial success and only tombstones an explicit missing record', async () => {
  const ambiguous404 = new StravaApiError('Authorization Error', 404);
  const result = await fetchStravaActivities(
    {
      accessToken: 'token',
      athleteId: 42,
      activityIds: [1, 2, 3, 4],
      persist: false,
    },
    {
      createClient: () => ({
        async getActivity(id) {
          if (id === 2) throw ambiguous404;
          if (id === 3) throw new StravaApiError('Record Not Found', 404);
          if (id === 4)
            throw new StravaApiError('Record Not Found in cache', 404);
          return stravaActivity(id);
        },
        async getActivities() {
          throw new Error('list fetch must not run');
        },
        async getActivityPhotos() {
          throw new Error('photo fetch must not run');
        },
      }),
    },
  );

  assert.deepEqual(
    result.activities.map((activity) => activity.id),
    [1],
  );
  assert.deepEqual(result.failedIds, [2, 4]);
  assert.deepEqual(
    result.failures?.map(({ activityId }) => activityId),
    [2, 4],
  );
  assert.deepEqual(result.notFoundIds, [3]);
});

void test('legacy photo sync avoids GPS-less zero-photo fanout while explicit refresh stays authoritative', async () => {
  const activities = new Map([
    [1, stravaActivity(1)],
    [2, stravaActivity(2, { total_photo_count: 1, photo_count: 1 })],
    [
      3,
      stravaActivity(3, {
        map: {
          id: 'map-3',
          polyline: 'detail-present',
          summary_polyline: null,
          resource_state: 3,
        },
      }),
    ],
  ]);
  const photoCalls: number[] = [];
  const photoFailure = new StravaApiError('limited', 429);
  const createClient = () => ({
    async getActivity(id: number) {
      return activities.get(id)!;
    },
    async getActivities() {
      throw new Error('list fetch must not run');
    },
    async getActivityPhotos(id: number) {
      photoCalls.push(id);
      if (id === 2) throw photoFailure;
      return [];
    },
  });

  const legacy = await fetchStravaActivities(
    {
      accessToken: 'token',
      athleteId: 42,
      activityIds: [1, 2, 3],
      includePhotos: true,
      persist: false,
    },
    { createClient },
  );
  assert.deepEqual(photoCalls, [2, 3]);
  assert.deepEqual(legacy.photoRefreshFailedIds, [2]);
  assert.deepEqual(legacy.photoRefreshAuthoritativeIds?.sort(), [1, 3]);
  assert.deepEqual(legacy.photoRefreshFailures, [
    { activityId: 2, error: photoFailure },
  ]);
  assert.equal(
    legacy.activities.find((activity) => activity.id === 1)?.photosState,
    'current',
  );

  photoCalls.length = 0;
  const explicit = await fetchStravaActivities(
    {
      accessToken: 'token',
      athleteId: 42,
      activityIds: [1],
      includePhotos: true,
      requireExisting: true,
      persist: false,
    },
    { createClient },
  );
  assert.deepEqual(photoCalls, [1]);
  assert.deepEqual(explicit.photoRefreshFailedIds, []);
  assert.deepEqual(explicit.photoRefreshAuthoritativeIds, [1]);
  assert.equal(explicit.activities[0]?.photosState, 'current');
});
