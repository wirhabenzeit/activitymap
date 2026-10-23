import assert from 'node:assert/strict';

import test from 'node:test';

import type { Feature, Streams } from '../matching';
import { gatewayRequest, inferTitle } from './gateway';
import { prepareJevInput } from './jev';
import { buildPlaceQuery, fetchOsmPlaces, placeKind, routeBounds } from './osm';

const points = [
  { lat: 46, lon: 7, km: 0 },
  { lat: 46, lon: 7.004, km: 0.3 },
];
const source = { series_type: 'time', resolution: 'high', original_size: 5 };
const streams: Streams = {
  latlng: {
    ...source,
    data: [0, 1, 2, 3, 4].map((i): [number, number] => [46, 7 + i * 0.001]),
  },
  altitude: { ...source, data: [1000, 1100, 1200, 1100, 1000] },
};
const peak: Feature = {
  id: 'node/123456789',
  name: 'Beispielberg',
  aliases: ['Example Peak'],
  kind: 'peak',
  lat: 46,
  lon: 7.002,
  elevation: 1200,
  tags: {
    name: 'Beispielberg',
    'name:en': 'Example Peak',
    natural: 'peak',
    ele: '1200',
  },
};
const prepared = () => prepareJevInput(streams, 'hike', [peak]);
const mockFetch =
  (body: unknown): typeof fetch =>
  async () =>
    Response.json(body);
function reply(p = prepared()) {
  return {
    model: 'typesafe-ai/jev',
    answers: Object.fromEntries(
      Object.keys(p.input.questions).map((k) => {
        const choice = k.endsWith('_visit')
          ? 'supported'
          : k.endsWith('_role')
            ? 'main'
            : 'none';
        return [
          k,
          {
            type: 'choice',
            choice,
            probabilities: { [choice]: 1 },
            confidence: 1,
          },
        ];
      }),
    ),
    usage: { inputTokens: 100 },
    providerMetadata: {
      gateway: { cost: '0.0001', generationId: 'test-generation' },
    },
  };
}

void test('lookup scope excludes ordinary labels and station-only objects', () => {
  assert.equal(placeKind({ natural: 'peak' }), 'peak');
  assert.equal(placeKind({ natural: 'saddle' }), 'pass');
  assert.equal(placeKind({ tourism: 'wilderness_hut' }), 'hut');
  assert.equal(placeKind({ place: 'hamlet' }), 'place');
  for (const tags of [
    { place: 'locality' },
    { place: 'square' },
    { place: 'neighbourhood' },
    { place: 'village', aerialway: 'station' },
  ] as Record<string, string>[])
    assert.equal(placeKind(tags), null);
  const query = buildPlaceQuery(points);
  assert.ok(query.includes('^(city|town|village|hamlet)$'));
  assert.ok(!query.includes('["place"]('));
  assert.ok(query.endsWith('out meta center;'));
});
void test('invalid and very large routes cannot produce a lookup', () => {
  assert.throws(() => routeBounds([]), /Invalid/);
  assert.throws(
    () => routeBounds([{ lat: NaN, lon: 7, km: 0 }, points[1]!]),
    /Invalid/,
  );
  assert.throws(
    () => routeBounds([points[0]!, { lat: 30, lon: 20, km: 1000 }]),
    /tiled/,
  );
});
void test('OSM decoding retains canonical identity and metadata while enforcing scope', async () => {
  const result = await fetchOsmPlaces(points, {
    fetch: mockFetch({
      elements: [
        {
          type: 'node',
          id: 1,
          lat: 46,
          lon: 7,
          tags: { name: 'Peak', natural: 'peak' },
          version: 2,
          timestamp: '2026-10-22T00:00:00Z',
        },
        {
          type: 'way',
          id: 2,
          center: { lat: 46, lon: 7 },
          tags: { name: 'Hut', tourism: 'wilderness_hut' },
        },
        {
          type: 'node',
          id: 3,
          lat: 46,
          lon: 7,
          tags: { name: 'Field', place: 'locality' },
        },
      ],
    }),
  });
  assert.deepEqual(
    result.places.map((p) => [p.id, p.kind]),
    [
      ['node/1', 'peak'],
      ['way/2', 'hut'],
    ],
  );
  assert.equal(result.places[0]!.osmVersion, 2);
});
void test('a validated cache entry avoids an OSM request; partial responses are not cached', async () => {
  const cache = new Map<string, unknown>();
  let requests = 0;
  const options = {
    cache: {
      get: async (k: string) => cache.get(k),
      set: async (k: string, v: unknown) => {
        cache.set(k, v);
      },
    },
    fetch: (async () => {
      requests++;
      return Response.json({ elements: [] });
    }) as typeof fetch,
  };
  await fetchOsmPlaces(points, options);
  await fetchOsmPlaces(points, options);
  assert.equal(requests, 1);
  const broken = {
    ...options,
    cache: {
      get: async () => undefined,
      set: async () => {
        throw new Error('Must not cache partial result');
      },
    },
    fetch: mockFetch({ elements: [], remark: 'Query timed out' }),
  };
  await assert.rejects(fetchOsmPlaces(points, broken), /Incomplete Overpass/);
});
void test('geographic evidence is broader than the model context and private fields are absent', () => {
  const p = prepareJevInput(streams, 'hike', [
    peak,
    {
      ...peak,
      id: 'node/987',
      name: 'Field',
      tags: { name: 'Field', place: 'locality' },
    },
  ]);
  assert.equal(p.places.length, 1);
  assert.equal(p.places[0]!.id, peak.id);
  assert.ok(p.encounters.length);
  assert.equal(p.encounters[0]!.placeId, peak.id);
  const body = JSON.stringify(gatewayRequest(p));
  for (const forbidden of [peak.id, 'latlng', 'activityId', '"lat":', '"lon":'])
    assert.ok(!body.includes(forbidden));
  assert.ok(body.includes('Example Peak'));
  assert.equal(
    prepareJevInput(streams, 'hike', [peak], 'local').context.features[0]!.name,
    'Beispielberg',
  );
});
void test('Gateway choice validation assembles a title and retains diagnostic cost', async () => {
  const p = prepared();
  const result = await inferTitle(p, {
    apiKey: 'test-only-key',
    fetch: mockFetch(reply(p)),
  });
  assert.equal(result.title, 'Example Peak');
  assert.equal(result.diagnostics.cost, 0.0001);
});
void test('missing or unexpected Gateway answers cannot silently generate a title', async () => {
  const p = prepared(),
    missing = reply(p);
  delete missing.answers.f1_visit;
  await assert.rejects(
    inferTitle(p, { apiKey: 'test-only-key', fetch: mockFetch(missing) }),
    /Invalid\/missing/,
  );
  const extra = reply(p);
  extra.answers.unexpected = {
    type: 'choice',
    choice: 'main',
    probabilities: { main: 1 },
    confidence: 1,
  };
  await assert.rejects(
    inferTitle(p, { apiKey: 'test-only-key', fetch: mockFetch(extra) }),
    /Unexpected answer/,
  );
});
void test('upstream errors do not expose response bodies or credentials', async () => {
  const secret = 'test-only-secret';
  await assert.rejects(
    inferTitle(prepared(), {
      apiKey: secret,
      fetch: async () => new Response(secret, { status: 401 }),
    }),
    (error) =>
      error instanceof Error && error.message === 'AI Gateway HTTP 401',
  );
});
