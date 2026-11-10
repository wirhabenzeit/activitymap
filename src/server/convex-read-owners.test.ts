import assert from 'node:assert/strict';

import test, { mock } from 'node:test';

import { convexReadEpoch } from './convex-read-owners';
import { logger } from './logging/logger';

const epoch = 'owner-epoch-0123456789';

void test('a listed owner gets its epoch, others stay on Postgres', () => {
  const environment = {
    ACTIVITYMAP_CONVEX_READ_OWNERS: JSON.stringify({ 'user-a': epoch }),
  };
  assert.equal(convexReadEpoch('user-a', environment), epoch);
  assert.equal(convexReadEpoch('user-b', environment), null);
  // Inherited object keys are not owners.
  assert.equal(convexReadEpoch('constructor', environment), null);
  assert.equal(convexReadEpoch('user-a', {}), null);
});

void test('invalid configuration keeps every account on Postgres', () => {
  const error = mock.method(logger, 'error', () => undefined);
  try {
    for (const value of [
      'user-a',
      '["user-a"]',
      '{"user-a":true}',
      '{"user-a":"short"}',
    ])
      assert.equal(
        convexReadEpoch('user-a', { ACTIVITYMAP_CONVEX_READ_OWNERS: value }),
        null,
      );
    assert.equal(error.mock.callCount(), 4);
  } finally {
    error.mock.restore();
  }
});
