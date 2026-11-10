import assert from 'node:assert/strict';

import test, { mock } from 'node:test';

import { convexLiveUrl, convexLiveUrlFor } from './convex-live-owners';
import { logger } from './logging/logger';

const url = 'https://example-123.convex.cloud';

void test('a listed owner gets the deployment URL, others do not', () => {
  const environment = {
    ACTIVITYMAP_CONVEX_URL: url,
    ACTIVITYMAP_CONVEX_LIVE_OWNERS: '["user-a","user-b"]',
  };
  assert.equal(convexLiveUrl('user-a', environment), url);
  assert.equal(convexLiveUrl('user-c', environment), null);
});

void test('live reads are off unless both settings are present', () => {
  assert.equal(convexLiveUrl('user-a', {}), null);
  assert.equal(
    convexLiveUrl('user-a', { ACTIVITYMAP_CONVEX_LIVE_OWNERS: '["user-a"]' }),
    null,
  );
  assert.equal(convexLiveUrl('user-a', { ACTIVITYMAP_CONVEX_URL: url }), null);
});

void test('invalid configuration turns live reads off instead of throwing', () => {
  const error = mock.method(logger, 'error', () => undefined);
  try {
    for (const environment of [
      { ACTIVITYMAP_CONVEX_URL: url, ACTIVITYMAP_CONVEX_LIVE_OWNERS: 'user-a' },
      {
        ACTIVITYMAP_CONVEX_URL: url,
        ACTIVITYMAP_CONVEX_LIVE_OWNERS: '{"user-a":true}',
      },
      {
        ACTIVITYMAP_CONVEX_URL: 'http://example.convex.cloud/path',
        ACTIVITYMAP_CONVEX_LIVE_OWNERS: '["user-a"]',
      },
    ])
      assert.equal(convexLiveUrl('user-a', environment), null);
    assert.equal(error.mock.callCount(), 3);
  } finally {
    error.mock.restore();
  }
});

void test('an account Convex writes for loads its library live, listed or not', () => {
  const environment = {
    ACTIVITYMAP_CONVEX_URL: url,
    ACTIVITYMAP_CONVEX_LIVE_OWNERS: '["user-a"]',
  };
  const user = (id: string, writer: string, convexEpoch: string | null) => ({
    id,
    writer,
    convexEpoch,
  });
  assert.equal(
    convexLiveUrlFor(
      user('user-b', 'convex', 'epoch-0123456789ab'),
      environment,
    ),
    url,
  );
  // Still copied, or moved without a recorded epoch: only the list counts.
  assert.equal(
    convexLiveUrlFor(
      user('user-b', 'postgres', 'epoch-0123456789ab'),
      environment,
    ),
    null,
  );
  assert.equal(
    convexLiveUrlFor(user('user-b', 'convex', null), environment),
    null,
  );
  assert.equal(
    convexLiveUrlFor(user('user-a', 'postgres', null), environment),
    url,
  );
  assert.equal(
    convexLiveUrlFor(user('user-b', 'convex', 'epoch-0123456789ab'), {}),
    null,
  );
});
