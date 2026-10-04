import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nearestElevationSample,
  elevationAxisTicks,
  elevationSelectionLabel,
  elevationDistanceLabel,
} from './elevation-profile';
import {
  toElevationProfile,
  type StreamSummaryResult,
} from './activity-stream-summary';
import { encodeStreamSummary } from './streams/compact-summary';
import { useElevationCursor } from '../store/elevation-cursor';

const metadata = {
  generation: 'g1',
  revision: '1',
  state: 'current',
  fetch_status: 'succeeded',
  available_types: [],
  fetched_at: null,
  expires_at: null,
} as const;

void test('scrubbing preserves aligned GPS and selects nearest distance, not evenly spaced indices', () => {
  const profile = toElevationProfile({
    metadata: { ...metadata, available_types: [] },
    summary: encodeStreamSummary({
      version: 1,
      basis: 'distance',
      distance: [100, 100, 200, 1100],
      altitude: [0, 2, 10, 5],
      latlng: [
        [47, 8],
        [47.001, 8.001],
        [47.002, 8.003],
        [47.004, 8.005],
      ],
    }),
  });
  assert.ok(profile);
  assert.equal(nearestElevationSample(profile, 100), 0);
  assert.equal(nearestElevationSample(profile, 510), 2);
  assert.deepEqual(profile.latlng?.[2], [47.002, 8.003]);
  assert.equal(nearestElevationSample(profile, -5), 0);
  assert.equal(nearestElevationSample(profile, 9999), 3);
  assert.equal(elevationDistanceLabel(10, 20), '10 m');
  assert.equal(elevationDistanceLabel(500, 2000), '0.5 km');
});

void test('elevation remains usable without GPS; stale data cannot produce a profile', () => {
  const summary = encodeStreamSummary({
    version: 1,
    basis: 'distance',
    distance: [0, 10],
    altitude: [0, 0],
  });
  const profile = toElevationProfile({
    metadata: { ...metadata, available_types: [] },
    summary,
  });
  assert.ok(profile);
  assert.equal(profile.latlng, undefined);
  assert.equal(
    toElevationProfile({
      metadata: { ...metadata, available_types: [], state: 'stale' },
      summary,
    }),
    null,
  );
});

void test('departing charts can only clear their own transient map cursor', () => {
  const source: StreamSummaryResult = {
    summary: null,
    metadata: null,
    requestedAgainst: null,
    status: 'ready',
    message: null,
    retryAt: null,
    pollStartedAt: 0,
    pollAttempts: 0,
  };
  const cursor = {
    owner: 'first',
    activityId: '1',
    userId: 'u',
    coordinate: [47, 8] as [number, number],
    source,
  };
  useElevationCursor.getState().setCursor(cursor);
  useElevationCursor
    .getState()
    .setCursor({ ...cursor, owner: 'second', activityId: '2' });
  useElevationCursor.getState().clearCursor('first');
  assert.equal(useElevationCursor.getState().cursor?.activityId, '2');
  useElevationCursor.getState().clearCursor('second');
  assert.equal(useElevationCursor.getState().cursor, null);
});

void test('shared chart ticks use readable round intervals and compact values', () => {
  assert.deepEqual(elevationAxisTicks(0, 182.6), [0, 50, 100, 150]);
  assert.deepEqual(elevationAxisTicks(0, 42.7), [0, 10, 20, 30, 40]);
  assert.deepEqual(elevationAxisTicks(0, 800), [0, 200, 400, 600, 800]);
  assert.deepEqual(elevationAxisTicks(395, 455, 3), [400, 420, 440]);
  assert.equal(
    elevationSelectionLabel(91910, 489.8, 182600),
    '91.9 km · 490 m',
  );
  assert.equal(elevationSelectionLabel(123.4, 52.2, 800), '123 m · 52 m');
});

void test('profile display units do not change source distances or sample selection', () => {
  assert.equal(elevationDistanceLabel(1609.344, 3218.688, 'imperial'), '1 mi');
  assert.equal(elevationDistanceLabel(30.48, 100, 'imperial'), '100 ft');
  assert.equal(elevationSelectionLabel(1609.344, 30.48, 3218.688, 'imperial'), '1 mi · 100 ft');
});
