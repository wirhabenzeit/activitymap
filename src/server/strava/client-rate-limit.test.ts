import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStravaRateLimitUsage } from './client.ts';

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
