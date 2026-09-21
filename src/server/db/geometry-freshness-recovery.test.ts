import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGeometryRecovery,
  type CurrentGeometryRow,
  type GeometryFingerprint,
} from './geometry-freshness-recovery.ts';

function historical(
  id: string,
  overrides: Partial<GeometryFingerprint> = {},
): GeometryFingerprint {
  return {
    athleteId: '42',
    detailedPolyline: `detail-${id}`,
    id,
    mapId: `map-${id}`,
    summaryPolyline: `summary-${id}`,
    ...overrides,
  };
}

function current(
  row: GeometryFingerprint,
  overrides: Partial<CurrentGeometryRow> = {},
): CurrentGeometryRow {
  return {
    ...row,
    geometryState: 'refresh_required',
    ...overrides,
  };
}

void test('selects only an unchanged historical detailed route that is currently invalidated', () => {
  const old = historical('1');
  const result = classifyGeometryRecovery([old], [current(old)]);

  assert.deepEqual(result.candidates, [old]);
  assert.equal(result.routeIdentityChanged, 0);
  assert.equal(result.detailedPolylineChanged, 0);
});

void test('rejects changed route identities and detailed polylines', () => {
  const mapChanged = historical('1');
  const summaryChanged = historical('2');
  const detailChanged = historical('3');
  const detailMissing = historical('4');
  const result = classifyGeometryRecovery(
    [mapChanged, summaryChanged, detailChanged, detailMissing],
    [
      current(mapChanged, { mapId: 'new-map' }),
      current(summaryChanged, { summaryPolyline: 'new-summary' }),
      current(detailChanged, { detailedPolyline: 'new-detail' }),
      current(detailMissing, { detailedPolyline: null }),
    ],
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.routeIdentityChanged, 2);
  assert.equal(result.detailedPolylineChanged, 2);
});

void test('rejects deleted, reassigned, and already-recovered rows', () => {
  const missing = historical('1');
  const reassigned = historical('2');
  const recovered = historical('3');
  const result = classifyGeometryRecovery(
    [missing, reassigned, recovered],
    [
      current(reassigned, { athleteId: '99' }),
      current(recovered, { geometryState: 'detailed' }),
    ],
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.missingFromTarget, 1);
  assert.equal(result.ownerChanged, 1);
  assert.equal(result.alreadyRecovered, 1);
});
