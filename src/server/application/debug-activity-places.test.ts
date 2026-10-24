import assert from 'node:assert/strict';

import test from 'node:test';

import {
  DEFAULT_PLACE_DEBUG_SETTINGS,
  placeDebugResponseSchema,
} from '~/contracts/place-debug';
import { createSyntheticCatalogue } from '~/server/places/catalogue.fixture';
import { SERVER_MATCHER_POLICY } from '~/server/places/matching-version';
import type { CandidatePlace } from '~/server/repositories/places';

import { debugActivityPlaces } from './debug-activity-places';
import { matchActivityPlaces } from './match-activity-places';

const candidate = (id: number, offsetM = 0): CandidatePlace => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  displayName: `Peak ${id}`,
  kinds: ['peak'],
  subtypes: ['peak'],
  location: { latitude: 46 + offsetM / 111195, longitude: 8 },
  elevationM: 100,
});
const stream = (data: unknown[]) => ({
  data,
  resolution: 'high',
  series_type: 'time',
  original_size: data.length,
});
const payload = {
  latlng: stream([
    [46, 7.9998],
    [46, 8],
    [46, 8.0002],
  ]),
  altitude: stream([100, 100, 100]),
  time: stream([0, 20, 40]),
  distance: stream([0, 20, 40]),
};
const options = (places = [candidate(1)]) => ({
  userId: 'owner',
  activityId: '1',
  input: { payload, generation: 'g', revision: '1' },
  catalogue: createSyntheticCatalogue(),
  settings: DEFAULT_PLACE_DEBUG_SETTINGS,
  discover: async () => ({
    candidates: places,
    covered: true,
    truncated: false,
  }),
});
void test('debug defaults match production and retain rejected candidates outside the entry radius', async () => {
  for (const [key, value] of Object.entries(DEFAULT_PLACE_DEBUG_SETTINGS))
    assert.equal(
      SERVER_MATCHER_POLICY[key as keyof typeof DEFAULT_PLACE_DEBUG_SETTINGS],
      value,
    );
  const input = options([candidate(1), candidate(2, 90), candidate(3, 200)]);
  const debug = placeDebugResponseSchema.parse(
    await debugActivityPlaces(input),
  );
  const normal = await matchActivityPlaces({
    ...input,
    policy: SERVER_MATCHER_POLICY,
  });
  assert.equal(debug.status, 'complete');
  assert.deepEqual(
    debug.candidates.filter((p) => p.status === 'matched').map((p) => p.id),
    normal.places.map((p) => p.id),
  );
  assert.equal(debug.candidates[1]!.status, 'rejected');
  assert(debug.candidates[1]!.reasons.includes('outside_relation_radius'));
  assert.equal(debug.candidates[2]!.status, 'rejected');
  assert(debug.candidates[2]!.reasons.includes('outside_entry_radius'));
  assert(Math.abs(debug.candidates[2]!.distanceM! - 200) < 1);
  assert(!JSON.stringify(debug).includes('latlng'));
});
void test('temporary thresholds gain and lose matches without mutating defaults', async () => {
  const input = options([candidate(1, 90)]);
  const gained = await debugActivityPlaces({
    ...input,
    settings: { ...input.settings, peakRadiusM: 95 },
  });
  assert.equal(gained.candidates[0]!.status, 'matched');
  assert.equal(gained.candidates[0]!.defaultMatched, false);
  const high = { ...candidate(1), elevationM: 250 };
  const rejected = await debugActivityPlaces(options([high]));
  assert(rejected.candidates[0]!.reasons.includes('outside_spatial_tolerance'));
  const accepted = await debugActivityPlaces({
    ...options([high]),
    settings: { ...input.settings, peakVerticalToleranceM: 200 },
  });
  assert.equal(accepted.candidates[0]!.status, 'matched');
  assert.equal(SERVER_MATCHER_POLICY.peakRadiusM, 72);
});
void test('uncertain GPS, coverage and truncation do not become conclusive rejections', async () => {
  const input = options();
  const isolated = await debugActivityPlaces({
    ...input,
    input: { ...input.input, payload: { latlng: stream([[46, 8]]) } },
  });
  assert.equal(isolated.candidates[0]!.status, 'uncertain');
  assert(isolated.candidates[0]!.reasons.includes('isolated_gps_sample'));
  const truncated = await debugActivityPlaces({
    ...input,
    discover: async () => ({
      candidates: [candidate(1)],
      covered: true,
      truncated: true,
    }),
  });
  assert.equal(truncated.status, 'partial');
  assert.equal(truncated.candidates[0]!.status, 'uncertain');
  assert.equal(truncated.candidates[0]!.defaultMatched, null);
  const uncovered = await debugActivityPlaces({
    ...input,
    discover: async () => ({
      candidates: [],
      covered: false,
      truncated: false,
    }),
  });
  assert.equal(uncovered.status, 'uncovered');
  assert.deepEqual(uncovered.candidates, []);
});
void test('invalid settings cannot change budgets; discovery retains default comparison corridor', async () => {
  const input = options();
  await assert.rejects(
    debugActivityPlaces({
      ...input,
      settings: { ...input.settings, peakRadiusM: 1000 },
    }),
  );
  await assert.rejects(
    debugActivityPlaces({
      ...input,
      settings: {
        ...input.settings,
        maxCandidates: 5000,
      } as typeof input.settings,
    }),
  );
  let radius = 0;
  await debugActivityPlaces({
    ...input,
    settings: { ...input.settings, discoveryRadiusM: 200 },
    discover: async (request) => {
      radius = request.radiusM;
      return { candidates: [], covered: true, truncated: false };
    },
  });
  assert.equal(radius, 300);
});

void test('debug exposes the best spatial scoring point separately from the closest point and identifies fallback', async () => {
  const input = options();
  const data = {
    ...payload,
    latlng: stream([
      [46, 8],
      [46, 8.0002],
    ]),
    altitude: stream([0, 100]),
    time: stream([0, 20]),
    distance: stream([0, 20]),
  };
  const debug = placeDebugResponseSchema.parse(
    await debugActivityPlaces({
      ...input,
      input: { ...input.input, payload: data },
      settings: { ...input.settings, peakVerticalToleranceM: 20 },
    }),
  );
  const place = debug.candidates[0]!;
  assert.equal(place.status, 'matched');
  assert.equal(place.distanceM, 0);
  assert.equal(place.altitudeDifferenceM, -100);
  assert(place.peakMatch!.score < 1);
  assert(place.peakMatch!.horizontalDistanceM > 10);
  assert.equal(place.peakMatch!.usesElevation, true);
  const { altitude, ...withoutAltitude } = data;
  void altitude;
  const fallback = await debugActivityPlaces({
    ...input,
    input: { ...input.input, payload: withoutAltitude },
  });
  assert.equal(fallback.candidates[0]!.peakMatch!.usesElevation, false);
  assert.equal(fallback.candidates[0]!.peakMatch!.spatialDistanceM, null);
});
