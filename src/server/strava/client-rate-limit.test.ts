import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StravaApiError,
  StravaClient,
  parseStravaRateLimitUsage,
} from './client.ts';

void test('parses Strava overall and read rate-limit headers', () => {
  const usage = parseStravaRateLimitUsage(
    new Headers({
      'x-ratelimit-limit': '200,2000',
      'x-ratelimit-usage': '14,230',
      'x-readratelimit-limit': '100,1000',
      'x-readratelimit-usage': '9,120',
    }),
  );

  assert.deepEqual(usage, {
    overall: {
      limit15Minutes: 200,
      limitDaily: 2000,
      usage15Minutes: 14,
      usageDaily: 230,
    },
    read: {
      limit15Minutes: 100,
      limitDaily: 1000,
      usage15Minutes: 9,
      usageDaily: 120,
    },
  });
});

void test('ignores absent or malformed Strava rate-limit headers', () => {
  assert.equal(parseStravaRateLimitUsage(new Headers()), null);
  assert.equal(
    parseStravaRateLimitUsage(
      new Headers({
        'x-readratelimit-limit': 'not-a-limit',
        'x-readratelimit-usage': '9,120',
      }),
    ),
    null,
  );
});

void test('token refresh retains status and Retry-After without invoking persistence on failure', async (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    AUTH_STRAVA_ID: 'fixture',
    AUTH_STRAVA_SECRET: 'fixture',
    ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
  });
  t.after(() => {
    process.env = originalEnv;
  });
  let response = new Response(null, {
    status: 429,
    headers: { 'retry-after': '123' },
  });
  t.mock.method(globalThis, 'fetch', async () => response);
  let writes = 0;
  const client = StravaClient.withRefreshToken(
    'fixture-refresh',
    async () => {
      writes++;
    },
    {
      requestBudget: {
        reserve: async (read) => ({ read, startedAt: new Date() }),
        observe: async () => {
          return;
        },
      },
    },
  );
  for (const [status, delay] of [
    [429, 123],
    [401, 123],
    [503, 123],
  ] as const) {
    response = new Response(null, {
      status,
      headers: { 'retry-after': '123' },
    });
    await assert.rejects(
      () => client.refreshAccessToken(),
      (e) =>
        e instanceof StravaApiError &&
        e.status === status &&
        e.retryAfterSeconds === delay,
    );
  }
  response = new Response(null, {
    status: 429,
    headers: { 'retry-after': 'invalid' },
  });
  await assert.rejects(
    () => client.refreshAccessToken(),
    (e) => e instanceof StravaApiError && e.retryAfterSeconds === undefined,
  );
  response = Response.json({
    access_token: 'new',
    refresh_token: 'new-refresh',
    expires_at: 2000000000,
    expires_in: 3600,
  });
  assert.equal((await client.refreshAccessToken()).access_token, 'new');
  assert.equal(
    writes,
    1,
    'failed refreshes retire the task slot so retry can persist successfully',
  );
});
