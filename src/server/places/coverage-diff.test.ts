import assert from 'node:assert/strict';

import test from 'node:test';

import { coverageClearanceM } from './batch-coverage';
import { tileOf } from './catalogue-rows';
import { type CoverageGeometry, parseCoverageGeometry } from './coverage';
import { coverageChangeTiles } from './coverage-diff';
import { SERVER_MATCHER_POLICY } from './matching-version';

const clearanceM = coverageClearanceM(SERVER_MATCHER_POLICY.discoveryRadiusM);

type Box = [west: number, south: number, east: number, north: number];
const ring = ([west, south, east, north]: Box) => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];
const coverage = (...polygons: Box[][]): CoverageGeometry =>
  parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: polygons.map((boxes) => boxes.map(ring)),
  });
const tile = (longitude: number, latitude: number) =>
  tileOf({ longitude, latitude });
/** Every tile that touches the box. */
function tilesOf([west, south, east, north]: Box) {
  const tiles: string[] = [];
  for (
    let x = Math.floor((west + 180) * 4);
    x <= Math.floor((east + 180) * 4);
    x++
  )
    for (
      let y = Math.floor((south + 90) * 4);
      y <= Math.floor((north + 90) * 4);
      y++
    )
      tiles.push(`${x},${y}`);
  return tiles;
}
/** Degrees of latitude and of longitude at `latitude` for `metres`. */
const degrees = (metres: number, latitude: number) => {
  const lat = metres / 111_195;
  return { lat, lon: lat / Math.cos((latitude * Math.PI) / 180) };
};

const base = coverage([[7, 45, 10, 48]]);

void test('an unchanged coverage has no tiles', () => {
  assert.deepEqual(
    coverageChangeTiles(base, coverage([[7, 45, 10, 48]]), clearanceM),
    [],
  );
});

void test('an added region returns all its tiles, inside as well as at its border', () => {
  const added: Box = [12, 45, 14, 47];
  const tiles = new Set(
    coverageChangeTiles(base, coverage([[7, 45, 10, 48]], [added]), clearanceM),
  );
  const pad = degrees(clearanceM, 47);
  for (const expected of tilesOf([
    added[0] - pad.lon,
    added[1] - pad.lat,
    added[2] + pad.lon,
    added[3] + pad.lat,
  ]))
    assert.ok(tiles.has(expected), expected);
  // Nothing further than twice the clearance from the added region.
  const far = degrees(2 * clearanceM + 600, 47);
  const allowed = new Set(
    tilesOf([
      added[0] - far.lon,
      added[1] - far.lat,
      added[2] + far.lon,
      added[3] + far.lat,
    ]),
  );
  assert.deepEqual(
    [...tiles].filter((t) => !allowed.has(t)),
    [],
  );
  // Removing it again concerns the same tiles.
  assert.deepEqual(
    coverageChangeTiles(coverage([[7, 45, 10, 48]], [added]), base, clearanceM),
    [...tiles].sort(),
  );
});

void test('a thin sliver is found, with the tiles within the clearance of it', () => {
  // The border moves east by a tenth of a metre at 10.003°E, about 230 m
  // east of the tile edge at 10°E.
  const moved = coverage([[7, 45, 10.003 + 1e-6, 48]]);
  const before = coverage([[7, 45, 10.003, 48]]);
  const tiles = new Set(coverageChangeTiles(before, moved, clearanceM));
  assert.ok(tiles.has(tile(10.1, 46.6)), 'the tile holding the sliver');
  assert.ok(tiles.has(tile(9.9, 46.6)), 'the tile within the clearance');
  assert.ok(!tiles.has(tile(8.5, 46.6)), 'the unchanged inside');

  // 2.3 km away the neighbouring tile column is not affected.
  const further = coverageChangeTiles(
    coverage([[7, 45, 10.03, 48]]),
    coverage([[7, 45, 10.03 + 1e-6, 48]]),
    clearanceM,
  );
  assert.ok(further.includes(tile(10.1, 46.6)));
  assert.ok(!further.includes(tile(9.9, 46.6)));
});

void test('a new hole concerns the tiles around it only', () => {
  const hole: Box = [8.4, 46.4, 8.6, 46.6];
  const tiles = coverageChangeTiles(
    base,
    coverage([[7, 45, 10, 48], hole]),
    clearanceM,
  );
  assert.ok(tiles.includes(tile(8.5, 46.5)));
  assert.ok(tiles.length <= 9, `${tiles.length} tiles`);
  assert.ok(!tiles.includes(tile(7.5, 45.5)));
});
