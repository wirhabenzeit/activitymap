import assert from 'node:assert/strict';

import test from 'node:test';

import { longitudeSpacing, tileCell, tileName } from './copernicus-dem';
import {
  type DemGrid,
  bilinear,
  circularRunMaxima,
  measureTerrain,
  passTerrain,
} from './terrain';
import { gridAround, syntheticDem } from './terrain.fixture';
import type { NormalizedPlace } from './types';

const lon = 8.5,
  lat = 47.3;
const near = (actual: number, expected: number, tolerance: number) =>
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

void test('bilinear interpolates inside cells and rejects points outside', () => {
  const grid: DemGrid = {
    west: 0,
    north: 1,
    dx: 1,
    dy: 1,
    width: 2,
    height: 2,
    values: Float32Array.from([0, 10, 20, 30]),
  };
  assert.equal(bilinear(grid, 0.5, 0.5), 15);
  assert.equal(bilinear(grid, 1, 0), 30);
  assert(Number.isNaN(bilinear(grid, 1.5, 0.5)));
});

void test('circular runs join across the start of the profile', () => {
  assert.deepEqual(
    circularRunMaxima([true, false, true, true], [5, 0, 2, 7]),
    [7],
  );
  assert.deepEqual(
    circularRunMaxima([false, true, false, true], [0, 3, 0, 4]),
    [3, 4],
  );
  assert.deepEqual(circularRunMaxima([true, true], [1, 2]), [2]);
  assert.deepEqual(circularRunMaxima([false, false], [1, 2]), []);
});

void test('circle test scores a saddle by its weaker side and a slope as zero', () => {
  // Ridge running north-south, valleys east and west: z = 1000 + k(n² - e²).
  const saddle = passTerrain(
    gridAround(lon, lat, (e, n) => 1_000 + 0.00002 * (n * n - e * e)),
    lon,
    lat,
  )!;
  assert.equal(saddle.radiusM, 2_500);
  near(saddle.ampM, 0.00002 * 2_500 ** 2, 1);

  // Flanks rise 200 m but one valley drops only 40 m: amp is the drop.
  const shallow = passTerrain(
    gridAround(lon, lat, (e, n) => {
      const flank = 200 * Math.min(1, Math.abs(n) / 800);
      const valley = (e > 0 ? 40 : 300) * Math.min(1, Math.abs(e) / 800);
      return 1_000 + flank - valley;
    }),
    lon,
    lat,
  )!;
  near(shallow.ampM, 40, 1);

  // A road over a plain slope has one arc above and one below: no saddle.
  const slope = passTerrain(
    gridAround(lon, lat, (e) => 600 + 0.1 * e),
    lon,
    lat,
  )!;
  near(slope.ampM, 0, 1e-6);
  near(
    passTerrain(
      gridAround(lon, lat, () => 450),
      lon,
      lat,
    )!.ampM,
    0,
    1e-6,
  );
});

void test('circle test skips radii that reach missing data', () => {
  const grid = gridAround(lon, lat, (e, n) =>
    Math.hypot(e, n) > 1_000 ? Number.NaN : 1_000 + 0.0001 * (n * n - e * e),
  );
  const result = passTerrain(grid, lon, lat)!;
  assert.equal(result.radiusM, 800);
  near(result.ampM, 0.0001 * 800 ** 2, 1);
  assert.equal(
    passTerrain(
      gridAround(lon, lat, () => Number.NaN),
      lon,
      lat,
    ),
    undefined,
  );
});

void test('measureTerrain stores a decimetre amp for the selected passes only', async () => {
  const base = {
    osm_type: 'node',
    names: { name: 'x' },
    tags: {},
    osm_version: 1,
    osm_updated_at: '2026-10-20T00:00:00Z',
    point_derivation: 'osm_node',
    normalization_version: 'osm-places-v2',
    catalogue_snapshot_id: 'test',
    location: { longitude: lon, latitude: lat },
  } as const;
  const rows: NormalizedPlace[] = [
    {
      ...base,
      osm_id: '1',
      kinds: ['pass'],
      subtypes: ['road_trail_pass'],
      display_name: 'Road pass',
      pass_highways: ['tertiary'],
    },
    {
      ...base,
      osm_id: '2',
      kinds: ['pass'],
      subtypes: ['natural_saddle'],
      display_name: 'Trail col',
      pass_highways: ['path'],
      pass_amp_m: 3,
    },
    {
      ...base,
      osm_id: '3',
      kinds: ['peak'],
      subtypes: ['peak'],
      display_name: 'Peak',
    },
  ];
  const measured = await measureTerrain(
    rows,
    syntheticDem((e, n) => 1_000 + 0.00002 * (n * n - e * e)),
    { select: (row) => !!row.pass_highways?.includes('tertiary') },
  );
  assert(measured[0]!.pass_amp_m! > 100);
  assert.equal(
    measured[0]!.pass_amp_m,
    Math.round(measured[0]!.pass_amp_m! * 10) / 10,
  );
  // A stale amp on an unselected pass is removed.
  assert.equal(measured[1]!.pass_amp_m, undefined);
  assert.equal(measured[2], rows[2]);
});

void test('Copernicus tiles use point pixels and widen towards the poles', () => {
  assert.equal(tileName(46, 8), 'Copernicus_DSM_COG_10_N46_00_E008_00_DEM');
  assert.equal(tileName(-1, -1), 'Copernicus_DSM_COG_10_S01_00_W001_00_DEM');
  assert.deepEqual(tileCell(8.5, 47.5), {
    name: 'Copernicus_DSM_COG_10_N47_00_E008_00_DEM',
    south: 47,
    west: 8,
    row: 1800,
    col: 1800,
    width: 3600,
  });
  // 48° N is the first row of N47; 47° N is the first row of N46.
  assert.equal(tileCell(8.2, 48).name, tileName(47, 8));
  assert.equal(tileCell(8.2, 48).row, 0);
  assert.equal(tileCell(8.2, 47).name, tileName(46, 8));
  assert.equal(tileCell(8.2, 47).row, 0);
  assert.equal(tileCell(-0.5, -0.5).name, tileName(-1, -1));
  assert.equal(tileCell(8.5, 50.5).width, 2400);
  // Across the antimeridian a window continues in the westernmost tile.
  assert.equal(tileCell(180.0001, -44).name, tileName(-45, -180));
  assert.equal(tileCell(-180.001, -44).name, tileName(-45, 179));
  assert.equal(longitudeSpacing(49.9), 1 / 3600);
  near(longitudeSpacing(-55), 1.5 / 3600, 1e-15);
});
