import assert from 'node:assert/strict';

import test from 'node:test';

import { DEFAULT_MATCHER_POLICY } from './policy';
import { peakSpatialScore } from './spatial-score';

void test('weighted spatial score has an elliptical boundary and preserves signed elevation and zero values', () => {
  const policy = {
    ...DEFAULT_MATCHER_POLICY,
    peakRadiusM: 50,
    peakVerticalToleranceM: 100,
  };
  const boundary = peakSpatialScore(30, 180, 100, policy);
  assert.equal(boundary.score, 1);
  assert.equal(boundary.usesElevation, true);
  assert.equal(boundary.altitudeDifferenceM, 80);
  assert.equal(boundary.spatialDistanceM, Math.hypot(30, 80));
  assert.equal(peakSpatialScore(30, 20, 100, policy).score, 1);
  assert.equal(peakSpatialScore(30, 181, 100, policy).score > 1, true);
  assert.deepEqual(peakSpatialScore(0, 0, 0, policy), {
    score: 0,
    usesElevation: true,
    altitudeDifferenceM: 0,
    spatialDistanceM: 0,
  });
  for (const [recorded, mapped] of [
    [undefined, 100],
    [100, undefined],
    [undefined, undefined],
  ]) {
    const fallback = peakSpatialScore(30, recorded, mapped, policy);
    assert.equal(fallback.score, 0.6);
    assert.equal(fallback.usesElevation, false);
  }
});
