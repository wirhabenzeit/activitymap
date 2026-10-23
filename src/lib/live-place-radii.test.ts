import assert from 'node:assert/strict';

import test from 'node:test';

import type { LiveCandidate } from '~/contracts/live-places';
import { DEFAULT_LIVE_RADII } from '~/contracts/live-places';

import { livePlaceRadii, livePlaceStatus } from './live-place-radii';
import { visibleVisitedPlaces } from './visited-places';

const place: LiveCandidate = {
  id: '6eef6c83-3451-413d-bbac-f21bec795843',
  name: 'Mountain hut',
  kinds: ['hut'],
  elevationM: null,
  longitude: 8,
  latitude: 46,
  osmType: 'node',
  osmId: '1',
  activityIds: ['100', '200'],
  evaluations: [
    { activityId: '100', complete: true, supportedKinds: ['hut'] },
    { activityId: '200', complete: true, supportedKinds: [] },
  ],
};
void test('radius polygons use physical metres at different latitudes and scale with thresholds', () => {
  for (const latitude of [0, 46, 70])
    for (const hutRadiusM of [10, 50, 100]) {
      const shape = livePlaceRadii([{ ...place, latitude }], {
        ...DEFAULT_LIVE_RADII,
        hutRadiusM,
      });
      const ring = shape.features[0]!.geometry.coordinates[0]!;
      assert.deepEqual(ring[0], ring.at(-1));
      assert.equal(ring.length, 65);
      for (const [lon, lat] of ring) {
        const radians = Math.PI / 180;
        const a =
          Math.sin(((lat! - latitude) * radians) / 2) ** 2 +
          Math.cos(latitude * radians) *
            Math.cos(lat! * radians) *
            Math.sin(((lon! - place.longitude) * radians) / 2) ** 2;
        const distance =
          2 * 6_371_008.8 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        assert(Math.abs(distance - hutRadiusM) < 0.001);
      }
    }
});
void test('nearby and incomplete candidates remain visible without borrowing a hidden activity match', () => {
  assert.equal(livePlaceStatus(place), 'matched');
  const nearby = visibleVisitedPlaces([place], [200])[0]!;
  assert.equal(livePlaceStatus(nearby), 'nearby');
  const shape = livePlaceRadii([nearby], DEFAULT_LIVE_RADII);
  assert.equal(shape.features.length, 1);
  assert.equal(shape.features[0]!.properties.status, 'nearby');
  assert.equal(
    livePlaceStatus({
      ...nearby,
      evaluations: [
        { activityId: '200', complete: false, supportedKinds: ['hut'] },
      ],
    }),
    'incomplete',
  );
});
void test('places with multiple kinds have separate matching radii and per-kind outcomes', () => {
  const shape = livePlaceRadii(
    [{ ...place, kinds: ['peak', 'hut'] }],
    DEFAULT_LIVE_RADII,
  );
  assert.deepEqual(
    shape.features.map((f) => [
      f.properties.kind,
      f.properties.radiusM,
      f.properties.status,
    ]),
    [
      ['peak', 35, 'nearby'],
      ['hut', 50, 'matched'],
    ],
  );
});
