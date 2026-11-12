import assert from 'node:assert/strict';

import test from 'node:test';

import { toActivityDTO } from '~/contracts/v1/activity';
import { parseMutationActivityId } from '~/server/api/activity-id';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { ActivityMutationError } from '~/server/application/activities';
import type { Actor } from '~/server/auth/actor';
import { userKeyFor } from '~/server/http/rate-limit';
import type { Activity } from '~/server/records';

import {
  createFetchActivitySummariesHandler,
  createRefreshActivityHandler,
  createUpdateActivityHandler,
} from './activities/[id]/mutation-handler';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'bearer',
};

void test('first summary POST waits for the actor-scoped service and returns its saved count', async () => {
  let finish!: (count: number) => void;
  const pending = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const handler = createFetchActivitySummariesHandler({
    resolveActor: async () => actor,
    fetchSummaries: async (resolved) => {
      assert.deepEqual(resolved, actor);
      return pending;
    },
  });
  let returned = false;
  const request = handler(
    new Request('https://example.test/api/v1/activities', { method: 'POST' }),
  ).then((response) => {
    returned = true;
    return response;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returned, false);
  finish(200);
  const response = await request;
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(((await response.json()) as { data: number }).data, 200);
  assert.equal(
    (
      await handler(
        new Request('https://example.test/api/v1/activities', {
          method: 'POST',
          headers: { Origin: 'https://elsewhere.test' },
        }),
      )
    ).status,
    403,
  );
});

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 7,
    public_id: 49,
    athlete: 42,
    name: 'Morning Run',
    description: null,
    distance: 1000,
    moving_time: 300,
    elapsed_time: 320,
    total_elevation_gain: 12,
    sport_type: 'Run',
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    start_date_local: new Date('2026-01-01T01:00:00.000Z'),
    timezone: 'Europe/Zurich',
    start_latlng: null,
    end_latlng: null,
    achievement_count: 0,
    kudos_count: 0,
    comment_count: 0,
    athlete_count: 1,
    photo_count: 0,
    total_photo_count: 0,
    map_id: 'map-7',
    map_polyline: null,
    map_summary_polyline: null,
    map_bbox: null,
    trainer: false,
    commute: false,
    manual: false,
    private: false,
    flagged: false,
    workout_type: null,
    upload_id: null,
    average_speed: 3,
    max_speed: 4,
    calories: null,
    has_heartrate: false,
    average_heartrate: null,
    max_heartrate: null,
    heartrate_opt_out: false,
    display_hide_heartrate_option: false,
    elev_high: null,
    elev_low: null,
    pr_count: 0,
    has_kudoed: false,
    hide_from_home: false,
    gear_id: null,
    device_watts: null,
    average_watts: null,
    max_watts: null,
    weighted_average_watts: null,
    kilojoules: null,
    last_updated: new Date('2026-01-01T00:00:01.000Z'),
    geometryState: 'detailed',
    photosState: 'current',
    lastSummarySeenAt: new Date('2026-01-01T00:00:01.000Z'),
    lastDetailedFetchedAt: new Date('2026-01-01T00:00:01.000Z'),
    is_complete: true,
    ...overrides,
  };
}

const request = (path: string, body?: unknown) =>
  new Request(`https://app.test${path}`, {
    method: path.endsWith('/refresh') ? 'POST' : 'PATCH',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const dto = (overrides: Partial<Activity> = {}) =>
  toActivityDTO(activity(overrides));

void test('PATCH validates its inputs and passes exactly the fields that were sent', async () => {
  const inputs: unknown[] = [];
  const handler = createUpdateActivityHandler({
    resolveActor: async () => actor,
    updateThroughConvex: async (resolved, input) => {
      assert.deepEqual(resolved, actor);
      inputs.push(input);
      return dto({ name: 'Renamed' });
    },
  });
  assert.equal(
    (await handler(request('/api/v1/activities/x', { name: 'x' }), null))
      .status,
    400,
  );
  assert.equal(
    (await handler(request('/api/v1/activities/7', { name: 5 }), 7)).status,
    400,
  );
  assert.equal(inputs.length, 0);

  const response = await handler(
    request('/api/v1/activities/7', { name: 'Renamed' }),
    7,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(
    ((await response.json()) as { data: { name: string } }).data.name,
    'Renamed',
  );
  // An omitted field stays omitted: it is not sent on as an empty value.
  assert.deepEqual(inputs, [{ id: 7, name: 'Renamed' }]);
});

void test('mutation errors keep their status, retry guidance and recovery details', async () => {
  const errors: unknown[] = [];
  const failing = (error: unknown) =>
    createUpdateActivityHandler({
      resolveActor: async () => actor,
      updateThroughConvex: async () => {
        throw error;
      },
      onError: (reported) => errors.push(reported),
    })(request('/api/v1/activities/7', { name: 'x' }), 7);

  const limited = await failing(
    new ActivityMutationError(
      'rate_limited',
      'Strava is busy.',
      429,
      true,
      120,
      { recovery: 'retry_later' },
    ),
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '120');
  const body = (await limited.json()) as {
    error: { code: string; retryable: boolean; details: unknown };
  };
  assert.deepEqual(
    [body.error.code, body.error.retryable, body.error.details],
    ['rate_limited', true, { recovery: 'retry_later' }],
  );
  assert.equal(errors.length, 0);

  const unexpected = await failing(new Error('bridge down'));
  assert.equal(unexpected.status, 500);
  assert.doesNotMatch(await unexpected.text(), /bridge down/);
  assert.equal(errors.length, 1);
});

void test('POST refresh reports the activity, its photos and how complete they are', async () => {
  const refresh = (
    photosError: {
      code: string;
      retryable: boolean;
      retryAfterSeconds?: number;
    } | null,
  ) =>
    createRefreshActivityHandler({
      resolveActor: async () => actor,
      refreshThroughConvex: (async (resolved: Actor, id: number) => {
        assert.deepEqual([resolved, id], [actor, 7]);
        return {
          activity: dto(),
          photos: [],
          photosStatus: photosError ? 'partial' : 'complete',
          photosError,
        };
      }) as never,
    })(request('/api/v1/activities/7/refresh'), 7);

  const complete = await refresh(null);
  assert.equal(complete.status, 200);
  const done = (await complete.json()) as {
    data: { photos_status: string; photos_error: unknown };
  };
  assert.deepEqual(
    [done.data.photos_status, done.data.photos_error],
    ['complete', null],
  );

  const partial = await refresh({
    code: 'rate_limited',
    retryable: true,
    retryAfterSeconds: 90,
  });
  assert.equal(partial.status, 200);
  assert.equal(partial.headers.get('retry-after'), '90');
  assert.deepEqual(
    (
      (await partial.json()) as {
        data: { photos_error: Record<string, unknown> };
      }
    ).data.photos_error,
    { code: 'rate_limited', retryable: true, retry_after_seconds: 90 },
  );
});

void test('every mutation requires an actor before anything is asked of the library', async () => {
  let calls = 0;
  const deps = {
    resolveActor: async () => null,
    updateThroughConvex: (async () => {
      calls++;
    }) as never,
    refreshThroughConvex: (async () => {
      calls++;
    }) as never,
  };
  for (const response of [
    await createUpdateActivityHandler(deps)(
      request('/api/v1/activities/7', { name: 'x' }),
      7,
    ),
    // Authentication is checked before the ID.
    await createUpdateActivityHandler(deps)(
      request('/api/v1/activities/x', { name: 'x' }),
      parseMutationActivityId('x'),
    ),
    await createRefreshActivityHandler(deps)(
      request('/api/v1/activities/7/refresh'),
      7,
    ),
    await createFetchActivitySummariesHandler({
      resolveActor: async () => null,
      fetchSummaries: async () => {
        calls++;
        return 0;
      },
    })(
      new Request('https://example.test/api/v1/activities', { method: 'POST' }),
    ),
  ])
    assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

void test('the shared per-user rate limit rejects a mutation before upstream work', async () => {
  const handler = withApiV1RateLimit(
    async () => {
      throw new Error('must not reach the mutation');
    },
    {
      route: 'PATCH /api/v1/activities/{id}',
      resolveUserId: async () => actor.userId,
      repo: {
        async incrementAndGet(key) {
          return key === userKeyFor(actor.userId) ? 601 : 1;
        },
      },
    },
  );
  const response = await handler(
    request('/api/v1/activities/7', { name: 'x' }),
  );
  assert.equal(response.status, 429);
  assert.ok(response.headers.has('retry-after'));
});

void test('a failed first fetch is reported, and a refused one keeps its reason', async () => {
  const errors: unknown[] = [];
  const post = (error: unknown) =>
    createFetchActivitySummariesHandler({
      resolveActor: async () => actor,
      fetchSummaries: async () => {
        throw error;
      },
      onError: (reported) => errors.push(reported),
    })(
      new Request('https://example.test/api/v1/activities', { method: 'POST' }),
    );
  assert.equal((await post(new Error('sweep failed'))).status, 500);
  assert.equal(errors.length, 1);
  const refused = await post(
    new ActivityMutationError('strava_not_connected', 'Reconnect Strava.', 409),
  );
  assert.equal(refused.status, 409);
  assert.equal(errors.length, 1);
});
