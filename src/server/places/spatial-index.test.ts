import assert from 'node:assert/strict';

import test from 'node:test';

import {
  EARTH_RADIUS_M,
  SpatialIndex,
  arc,
  arcDistanceM,
  bounds,
  combine,
  distanceM,
  pointArcDistanceM,
  ringContains,
  subdivide,
  vector,
} from './spatial-index';

const point = (lon: number, lat: number) => vector([lon, lat]);
const near = (actual: number, expected: number, epsilon = 1e-5) =>
  assert(
    Math.abs(actual - expected) < epsilon,
    `${actual} differs from ${expected}`,
  );
const oneDegree = (EARTH_RADIUS_M * Math.PI) / 180;

void test('spherical distances use arc interiors, endpoints and degenerate sections', () => {
  const equator = arc(point(-1, 0), point(1, 0));
  near(pointArcDistanceM(point(0, 0.001), equator), oneDegree * 0.001);
  near(pointArcDistanceM(point(2, 0), equator), oneDegree);
  near(
    pointArcDistanceM(point(0, 0.001), arc(point(0, 0), point(0, 0))),
    oneDegree * 0.001,
  );
  near(arcDistanceM(equator, arc(point(0, -1), point(0, 1))), 0);
  near(arcDistanceM(equator, arc(point(2, -1), point(2, 1))), oneDegree);
  // Same great circle, with and without overlap.
  near(arcDistanceM(equator, arc(point(0, 0), point(2, 0))), 0);
  near(arcDistanceM(equator, arc(point(2, 0), point(3, 0))), oneDegree);
});

void test('spherical index handles longitude wrap and poles locally', () => {
  const entries = [
    point(179.999, 0),
    point(-179.999, 0),
    point(0, 89.999),
    point(180, 89.999),
    point(0, 0),
  ];
  const index = new SpatialIndex(
    entries.map((value, id) => ({ box: bounds([value]), value: id })),
  );
  const dateline = arc(point(179.998, 0), point(-179.998, 0));
  assert.deepEqual(
    [...index.query(combine([dateline.box], 300))].sort(),
    [0, 1],
  );
  near(pointArcDistanceM(point(180, 0), dateline), 0);
  assert.deepEqual(
    [...index.query(bounds([point(0, 90)], 300))].sort(),
    [2, 3],
  );
  for (const i of [2, 3])
    near(distanceM(entries[i]!, point(0, 90)), oneDegree * 0.001);
});

void test('indexed arc envelopes retain sampled interiors and deduplicate overlapping cells', () => {
  // A curved arc whose interior lies outside its unpadded endpoint bounds.
  const a = point(7, 46),
    b = point(10, 46),
    samples = subdivide(a, b);
  const edge = arc(a, b);
  const index = new SpatialIndex(
    samples.map((value, id) => ({ box: bounds([value]), value: id })),
  );
  assert.equal(index.query(edge.box).size, samples.length);
  const boundary = new SpatialIndex([{ box: edge.box, value: 'edge' }]);
  assert.deepEqual([...boundary.query(edge.box)], ['edge']);
  for (const sample of samples) near(pointArcDistanceM(sample, edge), 0);
});

void test('signed spherical winding rejects the antipodal complement and respects hole orientation', () => {
  const ring = [
    [8, 46],
    [9, 46],
    [9, 47],
    [8, 47],
    [8, 46],
  ].map(vector);
  assert.equal(ringContains(point(8.5, 46.5), ring), true);
  assert.equal(ringContains(point(-171.5, -46.5), ring), false);
  assert.equal(ringContains(point(10, 46.5), ring), false);
  assert.equal(ringContains(point(8.5, 46.5), [...ring].reverse(), true), true);
  assert.throws(() => vector([NaN, 0]), /Invalid/);
  assert.throws(() => arc(point(0, 0), point(180, 0)), /Antipodal/);
});
