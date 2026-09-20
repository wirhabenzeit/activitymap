import assert from 'node:assert/strict';
import test from 'node:test';

import type { Account, Activity, Photo } from '~/server/db/schema';
import type { ActivitiesRepository } from '~/server/repositories/activities';
import type { PhotosRepository } from '~/server/repositories/photos';
import type { Actor } from '~/server/auth/actor';

import {
  ForbiddenError,
  deleteActivitiesForActor,
  getActivitiesForActor,
  getPhotosForActor,
  getUserActivities,
  refreshActivityForActor,
  updateActivityForActor,
} from './activities';

/**
 * These tests exercise the application service against in-memory fake
 * repositories - never a real database - so they double as proof that the
 * service depends only on the `ActivitiesRepository`/`PhotosRepository`
 * interfaces, not on Drizzle or a live Postgres connection.
 */

const ATHLETE_A = 1001;
const ATHLETE_B = 2002;

const actorFor = (athleteId: number, userId: string): Actor => ({
  userId,
  athleteId,
  authentication: 'cookie',
});

const ACTOR_A = actorFor(ATHLETE_A, 'user-a');
const ACTOR_B = actorFor(ATHLETE_B, 'user-b');

function buildActivity(overrides: Partial<Activity> & { id: number; athlete: number }): Activity {
  return {
    public_id: overrides.id * 7,
    name: `Activity ${overrides.id}`,
    description: null,
    distance: null,
    moving_time: null,
    elapsed_time: null,
    total_elevation_gain: null,
    sport_type: 'Run',
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    start_date_local: new Date('2026-01-01T00:00:00.000Z'),
    timezone: 'UTC',
    start_latlng: null,
    end_latlng: null,
    achievement_count: null,
    kudos_count: null,
    comment_count: null,
    athlete_count: null,
    photo_count: null,
    total_photo_count: null,
    map_id: null,
    map_polyline: null,
    map_summary_polyline: null,
    map_bbox: null,
    trainer: null,
    commute: null,
    manual: null,
    private: null,
    flagged: null,
    workout_type: null,
    upload_id: null,
    average_speed: null,
    max_speed: null,
    calories: null,
    has_heartrate: null,
    average_heartrate: null,
    max_heartrate: null,
    heartrate_opt_out: null,
    display_hide_heartrate_option: null,
    elev_high: null,
    elev_low: null,
    pr_count: null,
    has_kudoed: null,
    hide_from_home: null,
    gear_id: null,
    device_watts: null,
    average_watts: null,
    max_watts: null,
    weighted_average_watts: null,
    kilojoules: null,
    last_updated: new Date('2026-01-01T00:00:00.000Z'),
    geometryState: null,
    photosState: null,
    lastSummarySeenAt: null,
    lastDetailedFetchedAt: null,
    is_complete: false,
    ...overrides,
  };
}

function buildPhoto(overrides: Partial<Photo> & { unique_id: string; activity_id: number; athlete_id: number }): Photo {
  return {
    activity_name: null,
    caption: null,
    type: 0,
    source: null,
    urls: null,
    sizes: null,
    default_photo: null,
    location: null,
    uploaded_at: null,
    created_at: null,
    post_id: null,
    status: null,
    resource_state: null,
    ...overrides,
  };
}

function createFakeActivitiesRepository(seed: Activity[] = []): ActivitiesRepository {
  const rows = [...seed];
  return {
    async findManyByAthlete(athleteId, { limit = 10000, offset = 0 } = {}) {
      return rows
        .filter((row) => row.athlete === athleteId)
        .sort((a, b) => b.start_date.getTime() - a.start_date.getTime())
        .slice(offset, offset + limit);
    },
    async findManyByIds(ids) {
      const idSet = new Set(ids);
      return rows.filter((row) => idSet.has(row.id));
    },
    async deleteManyForAthlete(athleteId, ids) {
      const idSet = new Set(ids);
      const deletedIds: number[] = [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (row?.athlete === athleteId && idSet.has(row.id)) {
          deletedIds.push(row.id);
          rows.splice(i, 1);
        }
      }
      return deletedIds;
    },
    async upsertOne(activity) {
      const index = rows.findIndex((row) => row.id === activity.id);
      if (index >= 0) {
        rows[index] = activity;
      } else {
        rows.push(activity);
      }
      return activity;
    },
    async findPageByAthlete(athleteId, { afterId = 0, limit }) {
      return rows
        .filter((row) => row.athlete === athleteId && row.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
    },
  };
}

function createFakePhotosRepository(seed: Photo[] = []): PhotosRepository {
  return {
    async findManyByAthlete(athleteId) {
      return seed.filter((photo) => photo.athlete_id === athleteId);
    },
    async findManyByIds(ids) {
      const idSet = new Set(ids);
      return seed.filter((photo) => idSet.has(photo.unique_id));
    },
    async findPageByAthlete(athleteId, { afterId = '', limit }) {
      return seed
        .filter(
          (photo) => photo.athlete_id === athleteId && photo.unique_id > afterId,
        )
        .sort((a, b) => (a.unique_id < b.unique_id ? -1 : 1))
        .slice(0, limit);
    },
  };
}

const neverCalledAccountResolver = () => {
  throw new Error(
    'resolveAccount must not be called before the ownership check runs',
  );
};

const stubAccount = (overrides: Partial<Account> = {}): Account =>
  ({
    id: 'account-1',
    userId: 'user-a',
    accountId: String(ATHLETE_A),
    access_token: 'stub-token',
    ...overrides,
  }) as Account;

void test('getUserActivities only returns the actor athlete\'s own activities', async () => {
  const activitiesRepo = createFakeActivitiesRepository([
    buildActivity({ id: 1, athlete: ATHLETE_A }),
    buildActivity({ id: 2, athlete: ATHLETE_B }),
  ]);

  const result = await getUserActivities(ACTOR_A, {}, { activitiesRepo });

  assert.deepEqual(
    result.map((activity) => activity.id),
    [1],
  );
});

void test('getActivitiesForActor drops ids that belong to a different athlete, even when explicitly requested', async () => {
  const activitiesRepo = createFakeActivitiesRepository([
    buildActivity({ id: 1, athlete: ATHLETE_A }),
    buildActivity({ id: 2, athlete: ATHLETE_B }),
  ]);

  // User A supplies both their own id and user B's id.
  const result = await getActivitiesForActor(ACTOR_A, [1, 2], {
    activitiesRepo,
  });

  assert.deepEqual(
    result.map((activity) => activity.id),
    [1],
    'a caller-supplied id belonging to another athlete must never be returned',
  );
});

void test('getActivitiesForActor returns nothing when the actor supplies only another athlete\'s id', async () => {
  const activitiesRepo = createFakeActivitiesRepository([
    buildActivity({ id: 2, athlete: ATHLETE_B }),
  ]);

  const result = await getActivitiesForActor(ACTOR_A, [2], { activitiesRepo });

  assert.deepEqual(result, []);
});

void test('getPhotosForActor only returns the actor athlete\'s own photos', async () => {
  const photosRepo = createFakePhotosRepository([
    buildPhoto({ unique_id: 'p1', activity_id: 1, athlete_id: ATHLETE_A }),
    buildPhoto({ unique_id: 'p2', activity_id: 2, athlete_id: ATHLETE_B }),
  ]);

  const result = await getPhotosForActor(ACTOR_A, { photosRepo });

  assert.deepEqual(
    result.map((photo) => photo.unique_id),
    ['p1'],
  );
});

void test('updateActivityForActor rejects a cross-athlete update without ever resolving Strava credentials', async () => {
  const activitiesRepo = createFakeActivitiesRepository([
    buildActivity({ id: 42, athlete: ATHLETE_B, name: 'Belongs to B' }),
  ]);

  await assert.rejects(
    () =>
      updateActivityForActor(
        ACTOR_A,
        { id: 42, name: 'Renamed by A' },
        { activitiesRepo, resolveAccount: neverCalledAccountResolver },
      ),
    ForbiddenError,
  );
});

void test('refreshActivityForActor rejects a cross-athlete refresh without ever resolving Strava credentials', async () => {
  const activitiesRepo = createFakeActivitiesRepository([
    buildActivity({ id: 42, athlete: ATHLETE_B }),
  ]);

  await assert.rejects(
    () =>
      refreshActivityForActor(ACTOR_A, 42, {
        activitiesRepo,
        resolveAccount: neverCalledAccountResolver,
      }),
    ForbiddenError,
  );
});

void test('updateActivityForActor still requires an access token for an owned activity', async () => {
  const activitiesRepo = createFakeActivitiesRepository([
    buildActivity({ id: 7, athlete: ATHLETE_A }),
  ]);

  await assert.rejects(
    () =>
      updateActivityForActor(
        ACTOR_A,
        { id: 7, name: 'Still mine' },
        {
          activitiesRepo,
          resolveAccount: async () => stubAccount({ access_token: null }),
        },
      ),
    /No Strava access token found/,
  );
});

void test('deleteActivitiesForActor only deletes activities owned by the actor athlete', async () => {
  const activitiesRepo = createFakeActivitiesRepository([
    buildActivity({ id: 1, athlete: ATHLETE_A }),
    buildActivity({ id: 2, athlete: ATHLETE_B }),
  ]);

  const result = await deleteActivitiesForActor(ACTOR_A, [1, 2], {
    activitiesRepo,
  });

  assert.equal(result.deletedCount, 1);
  assert.equal(result.errors.length, 1);

  // Prove activity 2 (B's) is untouched: user A cannot delete it even by
  // supplying its id directly.
  const remaining = await activitiesRepo.findManyByIds([2]);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.athlete, ATHLETE_B);
});

void test('deleteActivitiesForActor deletes only the actor\'s own activities when ids from two athletes are mixed', async () => {
  const activitiesRepo = createFakeActivitiesRepository([
    buildActivity({ id: 1, athlete: ATHLETE_A }),
    buildActivity({ id: 2, athlete: ATHLETE_A }),
    buildActivity({ id: 3, athlete: ATHLETE_B }),
  ]);

  await deleteActivitiesForActor(ACTOR_B, [1, 2, 3], { activitiesRepo });

  const remaining = await activitiesRepo.findManyByAthlete(ATHLETE_A);
  assert.deepEqual(
    remaining.map((activity) => activity.id).sort(),
    [1, 2],
    'athlete B deleting a mixed id list must not remove athlete A\'s activities',
  );
});
