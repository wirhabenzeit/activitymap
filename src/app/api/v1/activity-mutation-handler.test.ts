import assert from 'node:assert/strict';
import test from 'node:test';

import type { Activity, Photo } from '~/server/db/schema';
import type { Actor } from '~/server/auth/actor';
import { ActivityMutationError } from '~/server/application/activities';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { userKeyFor } from '~/server/http/rate-limit';

import {
  createRefreshActivityHandler,
  createUpdateActivityHandler,
} from './activities/[id]/mutation-handler';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'bearer',
};

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

void test('PATCH validates ownership boundary inputs and preserves omitted versus empty fields', async () => {
  const seen: unknown[] = [];
  const handler = createUpdateActivityHandler({
    resolveActor: async () => actor,
    update: async (_actor, input) => {
      seen.push(input);
      return activity({ description: input.description ?? null });
    },
    now: () => new Date('2026-02-01T00:00:00.000Z'),
  });

  for (const [path, body] of [
    ['/api/v1/activities/0', { name: 'x' }],
    ['/api/v1/activities/7', {}],
    ['/api/v1/activities/7', { access_token: 'must-not-be-accepted' }],
    ['/api/v1/activities/7', { name: '   ' }],
    ['/api/v1/activities/7', { name: 'x'.repeat(256) }],
    ['/api/v1/activities/7', { description: 'x'.repeat(10_001) }],
  ] as const) {
    assert.equal((await handler(request(path, body))).status, 400);
  }

  const response = await handler(
    request('/api/v1/activities/7', { description: '' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [{ id: 7, description: '' }]);
  const json = (await response.json()) as {
    data: { id: string; description: string; streams?: unknown };
  };
  assert.equal(json.data.id, '7');
  assert.equal(json.data.description, '');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

void test('mutation errors retain status, retryability, retry guidance and recovery details', async () => {
  for (const [error, status, retryAfter] of [
    [
      new ActivityMutationError('rate_limited', 'limited', 429, true, 91),
      429,
      '91',
    ],
    [
      new ActivityMutationError(
        'local_persistence_failed',
        'save failed',
        503,
        true,
        undefined,
        { upstreamSucceeded: true, recovery: 'reconcile_or_retry_explicitly' },
      ),
      503,
      null,
    ],
    [
      new ActivityMutationError(
        'local_state_conflict',
        'refresh first',
        409,
        false,
        undefined,
        { upstreamSucceeded: true, recovery: 'refresh_before_retry' },
      ),
      409,
      null,
    ],
  ] as const) {
    const handler = createUpdateActivityHandler({
      resolveActor: async () => actor,
      update: async () => {
        throw error;
      },
    });
    const response = await handler(
      request('/api/v1/activities/7', { name: 'Updated' }),
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get('retry-after'), retryAfter);
    const body = (await response.json()) as {
      error: { code: string; retryable: boolean; details?: unknown };
    };
    assert.equal(body.error.code, error.code);
    assert.equal(body.error.retryable, error.retryable);
    if (
      error.code === 'local_persistence_failed' ||
      error.code === 'local_state_conflict'
    )
      assert.deepEqual(body.error.details, error.details);
  }
});

void test('POST refresh returns authoritative stream metadata and explicit photo completeness', async () => {
  const photo = {
    unique_id: 'photo-1',
    activity_id: 7,
    athlete_id: 42,
    activity_name: null,
    caption: null,
    type: 1,
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
  } satisfies Photo;
  for (const photosStatus of ['complete', 'partial'] as const) {
    const handler = createRefreshActivityHandler({
      resolveActor: async () => actor,
      refresh: async (_actor, id) => {
        assert.equal(id, 7);
        return {
          activity: Object.assign(activity(), {
            streamsMetadata: {
              generation: 'generation-1',
              revision: '3',
              state: 'current' as const,
              fetch_status: 'succeeded' as const,
              available_types: ['time' as const],
              fetched_at: '2026-01-01T00:00:01.000Z',
              expires_at: null,
            },
          }),
          photos: photosStatus === 'complete' ? [photo] : [],
          photosStatus,
          photosError:
            photosStatus === 'partial'
              ? {
                  code: 'rate_limited',
                  retryable: true,
                  retryAfterSeconds: 73,
                }
              : null,
        };
      },
    });
    const response = await handler(
      request('/api/v1/activities/7/refresh', {
        accessToken: 'ignored-client-secret',
        athleteId: '999',
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: {
        photos_status: string;
        photos_error: { code: string; retry_after_seconds: number } | null;
        photos: unknown[];
        activity: { streams: { generation: string; revision: string } };
      };
    };
    assert.equal(body.data.photos_status, photosStatus);
    assert.equal(body.data.photos.length, photosStatus === 'complete' ? 1 : 0);
    assert.equal(
      body.data.photos_error?.code ?? null,
      photosStatus === 'partial' ? 'rate_limited' : null,
    );
    assert.equal(
      response.headers.get('retry-after'),
      photosStatus === 'partial' ? '73' : null,
    );
    assert.deepEqual(body.data.activity.streams, {
      generation: 'generation-1',
      revision: '3',
      state: 'current',
      fetch_status: 'succeeded',
      available_types: ['time'],
      fetched_at: '2026-01-01T00:00:01.000Z',
      expires_at: null,
    });
  }
});

void test('both mutation routes require an actor before invoking the service', async () => {
  const update = createUpdateActivityHandler({
    resolveActor: async () => null,
    update: async () => {
      throw new Error('must not run');
    },
  });
  const refresh = createRefreshActivityHandler({
    resolveActor: async () => null,
    refresh: async () => {
      throw new Error('must not run');
    },
  });
  assert.equal(
    (await update(request('/api/v1/activities/7', { name: 'x' }))).status,
    401,
  );
  assert.equal(
    (await refresh(request('/api/v1/activities/7/refresh'))).status,
    401,
  );
});

void test('the shared per-user rate limit rejects a mutation before upstream work', async () => {
  const handler = withApiV1RateLimit(
    async () => {
      throw new Error('must not invoke mutation');
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
    request('/api/v1/activities/7', { name: 'Updated' }),
  );
  assert.equal(response.status, 429);
  assert.ok(response.headers.has('retry-after'));
});
