import assert from 'node:assert/strict';

import test from 'node:test';

import { createSyntheticCatalogue } from '~/server/places/catalogue.fixture';
import { DEFAULT_MATCHER_POLICY } from '~/server/places/policy';
import { placeQueryWindows } from '~/server/places/query-windows';
import { prepareTrack } from '~/server/places/track-sections';
import type { CandidatePlace } from '~/server/repositories/places';

import { createBatchActivityPlaceMatcher } from './batch-activity-places';
import { matchActivityPlaces } from './match-activity-places';

const catalogue = createSyntheticCatalogue();
const peak: CandidatePlace = {
  id: 'peak',
  displayName: 'Synthetic',
  kinds: ['peak'],
  subtypes: ['peak'],
  location: { longitude: 8.123456789, latitude: 46.987654321 },
  elevationM: 100,
};
const policy = {
  ...DEFAULT_MATCHER_POLICY,
  peakRadiusM: 72,
  peakVerticalToleranceM: 72,
};
function input(altitude = 100) {
  const stream = (data: unknown[]) => ({
    data,
    resolution: 'high',
    series_type: 'time',
    original_size: 3,
  });
  return {
    userId: 'u',
    activityId: '1',
    input: {
      generation: 'g',
      revision: '1',
      payload: {
        latlng: stream(
          [-0.0001, 0, 0.0001].map((dx) => [
            peak.location.latitude,
            peak.location.longitude + dx,
          ]),
        ),
        time: stream([0, 10, 20]),
        distance: stream([0, 10, 20]),
        altitude: stream([altitude, altitude, altitude]),
      },
    },
  };
}

void test('local batch preserves visit scoring, zero matches and missing-elevation fallback', async () => {
  for (const altitude of [100, 171, 300, undefined]) {
    const data = input(altitude);
    if (altitude === undefined)
      delete (data.input.payload as Record<string, unknown>).altitude;
    const batch = createBatchActivityPlaceMatcher({
      snapshot: { catalogue, places: [peak] },
      policy,
    });
    const reference = await matchActivityPlaces({
      ...data,
      catalogue,
      policy,
      discover: async () => ({
        covered: true,
        truncated: false,
        candidates: [peak],
      }),
    });
    assert.deepEqual(await batch.match(data), reference);
    assert.equal(batch.stats.coverageChecks, 1);
    if (altitude === undefined) assert.equal(reference.places.length, 1);
  }
});

void test('local candidate discovery deduplicates and returns explicit partial on budget exhaustion', async () => {
  const other = { ...peak, id: 'other' };
  const batch = createBatchActivityPlaceMatcher({
    snapshot: { catalogue, places: [peak, other] },
    policy: { ...policy, maxCandidates: 1 },
  });
  const result = await batch.match(input());
  assert.equal(result.status, 'partial');
  assert.equal(result.places.length, 0);
  assert.equal(batch.stats.candidateSearches, 1);
});

void test('uncovered sections are handled locally without a place query', async () => {
  const data = input();
  data.input.payload.latlng.data = [
    [0, 0],
    [0, 0.0001],
    [0, 0.0002],
  ];
  const batch = createBatchActivityPlaceMatcher({
    snapshot: { catalogue, places: [peak] },
    policy,
  });
  const result = await batch.match(data);
  assert.equal(result.status, 'uncovered');
  assert.equal(batch.stats.candidateSearches, 0);
});

void test('scoped snapshots match identically with a reused prepared track and reject out-of-scope inputs', async () => {
  const data = input();
  const track = prepareTrack(data.input.payload, policy);
  const windows = placeQueryWindows(track.geometry, policy.discoveryRadiusM);
  const batch = createBatchActivityPlaceMatcher({
    snapshot: { catalogue, places: [peak], windows },
    policy,
  });
  assert.deepEqual(
    await batch.match(
      { ...data, input: { ...data.input, payload: null } },
      track,
    ),
    await batch.match(data),
  );
  const other = input();
  other.input.payload.latlng.data = [
    [46, 9],
    [46, 9.0001],
    [46, 9.0002],
  ];
  await assert.rejects(batch.match(other), /exceeds the loaded/);
});
