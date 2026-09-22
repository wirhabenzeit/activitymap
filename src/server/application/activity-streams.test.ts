import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyStreamFetchFailure,
  createStreamSource,
} from './activity-streams';
import {
  StravaApiError,
  type StravaTokens,
  type StravaRateLimitUsage,
} from '~/server/strava/client';
import { rawActivityStreamsSchema } from '~/server/strava/streams';

void test('failure state distinguishes missing data from authorization, throttling and malformed responses', () => {
  for (const [status, code, retryable] of [
    [401, 'unauthorized', false],
    [403, 'unauthorized', false],
    [404, 'not_found', false],
    [429, 'rate_limited', true],
    [503, 'upstream_error', true],
    [400, 'upstream_error', false],
  ] as const) {
    assert.deepEqual(
      classifyStreamFetchFailure(
        new StravaApiError('ignored upstream body', status),
      ),
      { code, retryable },
    );
  }
  const malformed = rawActivityStreamsSchema.safeParse({ watts: [1] });
  assert.equal(malformed.success, false);
  if (!malformed.success)
    assert.deepEqual(classifyStreamFetchFailure(malformed.error), {
      code: 'invalid_response',
      retryable: false,
    });
  assert.deepEqual(
    classifyStreamFetchFailure(new TypeError('network failed')),
    { code: 'upstream_error', retryable: true },
  );
});

void test('source refreshes expired credentials through StravaClient before fetching streams', async (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    AUTH_STRAVA_ID: 'fixture-id',
    AUTH_STRAVA_SECRET: 'fixture-secret',
    ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
  });
  t.after(() => {
    process.env = originalEnv;
  });
  const now = new Date('2026-09-22T12:00:00Z');
  const refreshed: StravaTokens = {
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_at: 2_000_000_000,
    expires_in: 21600,
  };
  const order: string[] = [];
  const usage: StravaRateLimitUsage[] = [];
  const mockFetch = t.mock.method(
    globalThis,
    'fetch',
    async (url: string, init?: RequestInit) => {
      if (url.endsWith('/oauth/token')) {
        order.push('refresh');
        assert.equal(typeof init?.body, 'string');
        assert.equal(
          (JSON.parse(init?.body as string) as { refresh_token: string })
            .refresh_token,
          'old-refresh',
        );
        return Response.json(refreshed);
      }
      order.push('streams');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer new-access',
      );
      return Response.json(
        {},
        {
          headers: {
            'x-readratelimit-limit': '100,1000',
            'x-readratelimit-usage': '4,80',
          },
        },
      );
    },
  );
  const sourceOptions = {
    tokens: {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAtSeconds: 1,
      expiresAtDate: new Date(1000),
    },
    now,
    requestBudget: testBudget,
    onRefresh: async (tokens: StravaTokens) => {
      assert.deepEqual(tokens, refreshed);
      order.push('persist');
    },
    onRateLimit: (value: StravaRateLimitUsage) => {
      usage.push(value);
    },
  };
  assert.deepEqual(
    await createStreamSource(sourceOptions).getActivityStreams(
      '9007199254740993',
    ),
    {},
  );
  assert.deepEqual(order, ['refresh', 'persist', 'streams']);
  assert.equal(usage[0]?.read?.usageDaily, 80);

  order.length = 0;
  const cancelled = new Error('account revoked during refresh');
  const cancelledSource = createStreamSource({
    ...sourceOptions,
    onRefresh: async () => {
      throw cancelled;
    },
  });
  await assert.rejects(cancelledSource.getActivityStreams('1'), cancelled);
  await assert.rejects(cancelledSource.getActivityStreams('1'), cancelled);
  assert.deepEqual(
    order,
    ['refresh', 'refresh'],
    'failed credential guard prevents subsequent stream requests, including on reuse',
  );

  mockFetch.mock.mockImplementation(
    async (_url: string, init?: RequestInit) => {
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer valid-access',
      );
      return Response.json({});
    },
  );
  await createStreamSource({
    ...sourceOptions,
    tokens: {
      ...sourceOptions.tokens,
      accessToken: 'valid-access',
      expiresAtDate: new Date('2030-01-01'),
    },
  }).getActivityStreams('1');
  assert.throws(
    () =>
      createStreamSource({
        ...sourceOptions,
        tokens: { ...sourceOptions.tokens, refreshToken: null },
      }),
    StravaApiError,
  );
});

const testBudget = {
  async reserve(read: boolean) {
    return { startedAt: new Date(), read };
  },
  async observe() {
    return undefined;
  },
};
