import assert from 'node:assert/strict';

import test from 'node:test';

import {
  MATCHING_RECIPE_HASH,
  SERVER_MATCHER_POLICY,
  matchingVersion,
} from './matching-version';

void test('matching version follows catalogue, algorithm and settings identity', () => {
  const catalogue = { snapshotId: 'snapshot', revision: '1' };
  const version = matchingVersion(catalogue);
  assert.equal(version, matchingVersion({ ...catalogue }));
  for (const other of [
    matchingVersion({ ...catalogue, revision: '2' }),
    matchingVersion({ ...catalogue, snapshotId: 'new' }),
    matchingVersion(catalogue, 'different-recipe'),
  ])
    assert.notEqual(version, other);
  assert.match(MATCHING_RECIPE_HASH, /^[0-9a-f]{64}$/);
  assert.equal(SERVER_MATCHER_POLICY.peakRadiusM, 72);
  assert.equal(SERVER_MATCHER_POLICY.peakVerticalToleranceM, 72);
});
