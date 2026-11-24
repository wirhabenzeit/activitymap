import assert from 'node:assert/strict';

import type { GeometryCollection } from 'geojson';
import test from 'node:test';

import {
  coverageClearanceM,
  coverageContains,
  coveragePolygons,
  createBatchCoverage,
  routeSections,
} from './batch-coverage';
import { type CoverageGeometry, parseCoverageGeometry } from './coverage';
import {
  type Arc,
  SpatialIndex,
  arc,
  arcDistanceM,
  combine,
  subdivide,
} from './spatial-index';

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

/** The check as first written: every 500 m arc of the boundary indexed. */
function indexedCoverage(input: CoverageGeometry) {
  const polygons = coveragePolygons(input);
  const edges: Arc[] = [];
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const points = subdivide(ring[i - 1]!, ring[i]!);
        for (let j = 1; j < points.length; j++)
          edges.push(arc(points[j - 1]!, points[j]!));
      }
  const index = new SpatialIndex(
    edges.map((edge) => ({ box: edge.box, value: edge })),
  );
  return (sections: Arc[][], radiusM: number) => {
    const clearance = coverageClearanceM(radiusM);
    for (const section of sections) {
      if (!coverageContains(polygons, section[0]!.a)) return false;
      for (let start = 0; start < section.length; start += 64) {
        const block = section.slice(start, start + 64);
        const nearby = index.query(
          combine(
            block.map((edge) => edge.box),
            clearance,
          ),
        );
        for (const border of nearby)
          for (const edge of block)
            if (arcDistanceM(edge, border) <= clearance) return false;
      }
    }
    return true;
  };
}

void test('checking only the boundary near a route answers as indexing all of it', () => {
  // Long edges too: a ring wider than half the globe beside the squares.
  const wide = parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: [
      ...coverage.coordinates,
      [
        [
          [20, 50],
          [100, 50],
          [179, 50],
          [179, 60],
          [100, 62],
          [20, 60],
          [20, 50],
        ],
      ],
    ],
  });
  const expected = indexedCoverage(wide);
  const checker = createBatchCoverage(wide);
  let seed = 7;
  const random = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const vertices = wide.coordinates.flat(2);
  const answers = { covered: 0, uncovered: 0 };
  for (let n = 0; n < 600; n++) {
    const [lon, lat] = vertices[Math.floor(random() * vertices.length)]!;
    const spread = [2, 0.2, 0.02][n % 3]!;
    let x = lon! + (random() - 0.5) * spread;
    let y = lat! + (random() - 0.5) * spread;
    const points: number[][] = [];
    for (let i = 0, steps = 2 + Math.floor(random() * 150); i < steps; i++) {
      points.push([x, y]);
      x += (random() - 0.5) * 0.002;
      y += (random() - 0.5) * 0.002;
    }
    const sections = routeSections(geometry(...points));
    const radius = [50, 300, 1500][n % 3]!;
    const answer = checker.covers(sections, radius);
    assert.equal(answer, expected(sections, radius), `route ${n}`);
    answers[answer ? 'covered' : 'uncovered']++;
  }
  // Both answers occur often enough to compare.
  assert.ok(answers.covered > 100 && answers.uncovered > 100);
});
