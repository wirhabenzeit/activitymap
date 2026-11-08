import assert from 'node:assert/strict';

import type { GeometryCollection } from 'geojson';
import test from 'node:test';
import type postgres from 'postgres';

import type { CoverageGeometry } from '~/server/places/coverage';

import { createPlacesRepository } from './places';

function mockClient(results: unknown[][]) {
  const calls: { query: string; parameters: unknown[] }[] = [];
  const client = {
    options: { parsers: {}, serializers: {} },
    async unsafe(query: string, parameters: unknown[]) {
      calls.push({ query, parameters });
      const result = results.shift();
      if (!result) throw new Error('Unexpected database call');
      return result;
    },
  } as unknown as postgres.Sql;
  return { client, calls };
}

function freezeRecursively(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeRecursively(child);
    Object.freeze(value);
  }
}

function discoveryInput() {
  const geometry: GeometryCollection = {
    type: 'GeometryCollection',
    geometries: [
      {
        type: 'LineString',
        coordinates: [
          [8.5, 47],
          [8.501, 47.001],
        ],
      },
      { type: 'Point', coordinates: [8.6, 47.1] },
    ],
  };
  // Clockwise exterior is deliberately normalized on an internal copy.
  const coverage: CoverageGeometry = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [8, 46],
          [8, 48],
          [10, 48],
          [10, 46],
          [8, 46],
        ],
      ],
    ],
  };
  return {
    geometry,
    coverage,
    radiusM: 100,
    limit: 1,
    catalogueSnapshotId: 'test-snapshot',
  };
}

void test('discovery keeps caller GPS order and coverage geometry unchanged', async () => {
  const input = discoveryInput();
  const original = structuredClone(input);
  freezeRecursively(input);
  const { client, calls } = mockClient([
    [{ covered: false, catalogue_present: true }],
  ]);
  assert.deepEqual(await createPlacesRepository(client).discover(input), {
    candidates: [],
    covered: false,
    truncated: false,
  });
  assert.deepEqual(input, original);
  assert(calls[0]?.parameters.includes(JSON.stringify(original.geometry)));
  assert.equal(
    calls.length,
    1,
    'an uncovered corridor does not trigger a candidate query',
  );
});

void test('discovery rejects unsupported or out-of-range geometry before querying', async () => {
  const { client, calls } = mockClient([]);
  const repository = createPlacesRepository(client);
  for (const geometry of [
    { type: 'GeometryCollection', geometries: [] },
    {
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [8, 91] }],
    },
    {
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [8, 47, 2000] }],
    },
    {
      type: 'GeometryCollection',
      geometries: [
        {
          type: 'LineString',
          coordinates: [
            [179, 47],
            [-179, 47],
          ],
        },
      ],
    },
    {
      type: 'GeometryCollection',
      geometries: [
        {
          type: 'Polygon',
          coordinates: [
            [
              [8, 47],
              [8, 48],
              [9, 47],
              [8, 47],
            ],
          ],
        },
      ],
    },
  ]) {
    await assert.rejects(
      repository.discover({
        ...discoveryInput(),
        geometry: geometry as GeometryCollection,
      }),
    );
  }
  await assert.rejects(
    repository.discover({ ...discoveryInput(), radiusM: 2001 }),
  );
  await assert.rejects(
    repository.discover({ ...discoveryInput(), limit: 5001 }),
  );
  assert.equal(calls.length, 0);
});

void test('discovery decodes coordinate order and reports the limit sentinel', async () => {
  const candidate = {
    id: 'c31abc5a-f56b-4792-9325-dbb34c98bbec',
    display_name: 'Synthetic peak',
    kinds: ['peak'],
    subtypes: ['peak'],
    location: '0101000020E610000000000000000021400000000000804740',
    elevation_m: null,
  };
  const { client } = mockClient([
    [{ covered: true, catalogue_present: true }],
    [candidate, { ...candidate, id: 'fa23460c-85f7-4ed4-86da-f6c121f8f8b8' }],
  ]);
  assert.deepEqual(
    await createPlacesRepository(client).discover(discoveryInput()),
    {
      candidates: [
        {
          id: candidate.id,
          displayName: candidate.display_name,
          kinds: ['peak'],
          subtypes: ['peak'],
          location: { longitude: 8.5, latitude: 47 },
        },
      ],
      covered: true,
      truncated: true,
    },
  );
});
