import assert from 'node:assert/strict';

import test from 'node:test';

import {
  type Feature,
  type Point,
  matchFeature,
  routePoints,
  suggest,
} from './matching';

const peak = (name: string, lon: number, elevation: number): Feature => ({
  id: `node/${name}`,
  name,
  aliases: [],
  kind: 'peak',
  lat: 46,
  lon,
  elevation,
  tags: {},
});
const point = (lon: number, km: number, altitude: number): Point => ({
  lat: 46,
  lon,
  km,
  altitude,
});

void test('rejects a nearby summit when the route traverses below it', () => {
  const result = matchFeature(
    peak('Summit', 8.001, 2400),
    [point(8, 0, 2000), point(8.002, 0.2, 2000)],
    'hike',
  );
  assert.equal(result.accepted, false);
  assert.match(result.reason, /Elevation mismatch/);
});

void test('matches between GPS samples but does not bridge a long recording gap', () => {
  const summit = peak('Summit', 8.001, 2400);
  assert.equal(
    matchFeature(summit, [point(8, 0, 2380), point(8.002, 0.2, 2420)], 'hike')
      .accepted,
    true,
  );
  assert.equal(
    matchFeature(summit, [point(7.99, 0, 2400), point(8.01, 2, 2400)], 'hike')
      .accepted,
    false,
  );
});

void test('requires sampling metadata alignment, not just equal array lengths', () => {
  const { points, warnings } = routePoints({
    latlng: {
      data: [
        [46, 8],
        [46, 8.001],
      ],
      series_type: 'distance',
      resolution: 'high',
      original_size: 4,
    },
    altitude: {
      data: [100, 200],
      series_type: 'time',
      resolution: 'high',
      original_size: 4,
    },
  });
  assert.equal(points[0]?.altitude, undefined);
  assert.equal(warnings.length, 1);
});

void test('keeps two substantial summits in visit order', () => {
  const points = [
    point(8, 0, 1500),
    point(8.003, 1, 2000),
    point(8.006, 2, 1600),
    point(8.009, 3, 2100),
  ];
  assert.equal(
    suggest(
      points,
      [peak('First', 8.003, 2000), peak('Second', 8.009, 2100)],
      'hike',
    ).title,
    'First – Second',
  );
});

void test('suppresses a minor bump on the same ridge', () => {
  const points = [
    point(8, 0, 1950),
    point(8.003, 1, 2000),
    point(8.006, 2, 1970),
    point(8.009, 3, 2100),
  ];
  assert.equal(
    suggest(
      points,
      [peak('Minor', 8.003, 2000), peak('Main', 8.009, 2100)],
      'hike',
    ).title,
    'Main',
  );
});

void test('abstains when a hike has no matched summit', () => {
  const result = suggest(
    [point(8, 0, 1500), point(8.001, 1, 1600)],
    [],
    'hike',
  );
  assert.equal(result.title, null);
  assert.equal(result.confidence, 'low');
});

void test('does not invent a loop when an open ride has no named endpoint', () => {
  const route = Array.from({ length: 21 }, (_, i) =>
    point(8 + i * 0.003, i * 0.3, 500),
  );
  const town: Feature = {
    id: 'node/town',
    name: 'Start town',
    aliases: [],
    kind: 'place',
    lat: 46,
    lon: 8,
    tags: { place: 'town' },
  };
  const result = suggest(route, [town], 'bike');
  assert.equal(result.loop, false);
  assert.equal(result.title, null);
});

void test('flags a nearby peak well below an unmatched route high point', () => {
  const route = [
    point(8, 0, 2400),
    point(8.003, 1, 2280),
    point(8.006, 2, 2150),
  ];
  const result = suggest(route, [peak('Incidental', 8.003, 2280)], 'ski');
  assert.equal(result.confidence, 'low');
  assert.match(result.warnings.join(' '), /intended destination/);
});
