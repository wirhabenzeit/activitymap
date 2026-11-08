import assert from 'node:assert/strict';

import type { GeometryCollection } from 'geojson';
import test from 'node:test';

import { createBatchCoverage, routeSections } from './batch-coverage';
import { parseCoverageGeometry } from './coverage';

function square(w: number, s: number, size: number) {
  const ring: number[][] = [];
  const corners = [
    [w, s],
    [w + size, s],
    [w + size, s + size],
    [w, s + size],
    [w, s],
  ];
  for (let edge = 0; edge < 4; edge++)
    for (let i = 0; i < 20; i++) {
      const a = corners[edge]!,
        b = corners[edge + 1]!;
      ring.push([
        a[0]! + ((b[0]! - a[0]!) * i) / 20,
        a[1]! + ((b[1]! - a[1]!) * i) / 20,
      ]);
    }
  return [...ring, corners[0]!];
}
const coverage = parseCoverageGeometry({
  type: 'MultiPolygon',
  coordinates: [
    [square(8, 46, 1), square(8.3, 46.3, 0.1)],
    [square(10, 46, 1)],
  ],
});
const geometry = (...points: number[][]): GeometryCollection => ({
  type: 'GeometryCollection',
  geometries: [
    points.length === 1
      ? { type: 'Point', coordinates: points[0]! }
      : { type: 'LineString', coordinates: points },
  ],
});

void test('local corridor coverage handles interiors, borders, holes and crossings', () => {
  const checker = createBatchCoverage(coverage);
  const covered = (g: GeometryCollection) =>
    checker.covers(routeSections(g), 300);
  assert.equal(covered(geometry([8.7, 46.7], [8.701, 46.7])), true);
  assert.equal(covered(geometry([12, 46.7])), false);
  assert.equal(covered(geometry([8.001, 46.7])), false);
  assert.equal(covered(geometry([8.35, 46.35])), false);
  assert.equal(covered(geometry([8.299, 46.35])), false);
  assert.equal(covered(geometry([8.2, 46.35], [8.5, 46.35])), false);
  const disconnected: GeometryCollection = {
    type: 'GeometryCollection',
    geometries: [
      { type: 'Point', coordinates: [8.7, 46.7] },
      { type: 'Point', coordinates: [10.7, 46.7] },
    ],
  };
  assert.equal(covered(disconnected), true);
  assert.equal(covered(geometry([8.7, 46.7], [10.7, 46.7])), false);
});

void test('local coverage rejects distant, polar and dateline tracks without a fallback', () => {
  const checker = createBatchCoverage(coverage);
  for (const g of [
    geometry([179.999, 46], [-179.999, 46]),
    geometry([8, 80]),
    geometry([8, 46], [20, 46]),
    geometry([-171.3, -46.7]),
  ])
    assert.equal(checker.covers(routeSections(g), 300), false);
});

void test('corridor radius is respected near a straight border', () => {
  const checker = createBatchCoverage(coverage);
  assert.equal(
    checker.covers(routeSections(geometry([8.0035, 46.7])), 300),
    false,
  );
  assert.equal(
    checker.covers(routeSections(geometry([8.0045, 46.7])), 300),
    true,
  );
});
