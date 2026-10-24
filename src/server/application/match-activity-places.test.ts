import assert from 'node:assert/strict';

import test from 'node:test';

import { createSyntheticCatalogue } from '~/server/places/catalogue.fixture';
import type { CandidatePlace } from '~/server/repositories/places';

import { matchActivityPlaces } from './match-activity-places';

const catalogue = createSyntheticCatalogue();
const peak: CandidatePlace = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Test peak',
  kinds: ['peak'],
  subtypes: ['peak'],
  location: { longitude: 8, latitude: 46 },
  elevationM: 100,
};
function payload(
  options: {
    distances?: number[];
    altitudes?: number[];
    points?: number[][];
    times?: number[];
  } = {},
) {
  const points = options.points ?? [
    [46, 7.9998],
    [46, 8],
    [46, 8.0002],
  ];
  const stream = (data: unknown[]) => ({
    type: undefined,
    data,
    resolution: 'high',
    series_type: 'time',
    original_size: points.length,
  });
  return {
    latlng: stream(points),
    time: stream(options.times ?? points.map((_, i) => i * 20)),
    distance: stream(options.distances ?? points.map((_, i) => i * 20)),
    altitude: stream(options.altitudes ?? points.map(() => 100)),
  };
}
function run(
  data: unknown,
  candidates = [peak],
  overrides: { covered?: boolean; truncated?: boolean } = {},
) {
  return matchActivityPlaces({
    userId: 'u',
    activityId: '1',
    input: { payload: data, generation: 'g', revision: '2' },
    catalogue,
    discover: async () => ({
      candidates,
      covered: true,
      truncated: false,
      ...overrides,
    }),
  });
}
void test('on-demand results include only supported places, retain provider distances and do not expose raw evidence', async () => {
  const result = await run(payload());
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.places, [
    {
      id: peak.id,
      name: peak.displayName,
      kinds: ['peak'],
      longitude: 8,
      latitude: 46,
      elevationM: 100,
      visits: [{ distanceM: 20 }],
    },
  ]);
  const nearby = await run(payload({ altitudes: [300, 300, 300] }));
  assert.equal(nearby.status, 'complete');
  assert.deepEqual(nearby.places, []);
  assert(!JSON.stringify(result).includes('latlng'));
  assert(!JSON.stringify(result).includes('encounters'));
});
void test('incomplete checks and uncovered routes never become completed empty results', async () => {
  assert.equal(
    (await run(payload(), [peak], { covered: false })).status,
    'uncovered',
  );
  assert.equal(
    (await run(payload(), [peak], { truncated: true })).status,
    'partial',
  );
  assert.equal((await run(null)).status, 'missing_streams');
  const unsupported = await matchActivityPlaces({
    userId: 'u',
    activityId: '1',
    input: { payload: payload(), generation: 'g', revision: '2' },
    catalogue: null,
    discover: async () => {
      throw new Error('should not discover');
    },
  });
  assert.equal(unsupported.status, 'unavailable');
});
void test('GPS-only encounters remain map matches without inventing a global elevation position', async () => {
  const data = payload();
  delete (data as Partial<typeof data>).distance;
  const result = await run(data);
  assert.equal(result.places[0]?.visits[0]?.distanceM, null);
});
void test('repeated visits retain distinct route positions and mixed kinds expose only supported relations', async () => {
  const hut = {
    ...peak,
    kinds: ['peak', 'hut'] as ('peak' | 'hut')[],
    subtypes: ['peak', 'alpine_hut'] as ('peak' | 'alpine_hut')[],
  };
  const mixed = await run(payload({ altitudes: [300, 300, 300] }), [hut]);
  assert.deepEqual(mixed.places[0]?.kinds, ['hut']);
  const result = await run(
    payload({
      points: [
        [46, 7.9998],
        [46, 8],
        [46, 8.0002],
        [46, 8.0025],
        [46, 8.0002],
        [46, 8],
        [46, 7.9998],
      ],
    }),
  );
  assert.deepEqual(
    result.places[0]?.visits.map((v) => Math.round(v.distanceM!)),
    [20, 100],
  );
});

void test('peak profile visits use the best weighted scoring point instead of the horizontal closest point', async () => {
  const result = await run(
    payload({
      points: [
        [46, 8],
        [46, 8.0002],
      ],
      altitudes: [-100, 100],
      distances: [0, 20],
      times: [0, 20],
    }),
  );
  assert.equal(result.places.length, 1);
  assert(result.places[0]!.visits[0]!.distanceM! > 15);
});
