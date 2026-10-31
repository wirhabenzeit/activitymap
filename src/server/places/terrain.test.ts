import assert from 'node:assert/strict';

import test from 'node:test';

import { longitudeSpacing, tileCell, tileName } from './copernicus-dem';
import {
  type DemGrid,
  bilinear,
  circularRunMaxima,
  measureTerrain,
  passTerrain,
  peakTerrain,
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
  near(saddle.elevationM, 1_000, 0.1);
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

const cone =
  (east: number, north: number, top: number, slope: number) =>
  (e: number, n: number) =>
    top - slope * Math.hypot(e - east, n - north);

void test('priority flood finds the key col to higher ground', () => {
  const first = cone(0, 0, 1_000, 0.2),
    second = cone(1_000, 0, 1_100, 0.2);
  const result = peakTerrain(
    gridAround(lon, lat, (e, n) => Math.max(first(e, n), second(e, n))),
    lon,
    lat,
  )!;
  near(result.summitM, 1_000, 0.1);
  // Col at 250 m east, 950 m; the 30 m grid places it within one cell.
  near(result.prominenceM, 50, 6);
  assert.equal(result.capped, false);
});

void test('priority flood snaps to the highest cell within 250 m', () => {
  const bump = cone(200, 0, 1_000, 0.5),
    higher = cone(2_000, 0, 1_500, 0.4);
  const result = peakTerrain(
    gridAround(lon, lat, (e, n) => Math.max(bump(e, n), higher(e, n), 0)),
    lon,
    lat,
  )!;
  // The 30 m grid has no cell exactly on the bump's summit.
  near(result.summitM, 1_000, 6);
  assert.equal(result.capped, false);
  // Cones meet where 1000 - 0.5d1 = 1500 - 0.4d2, 444 m east at 878 m.
  near(result.prominenceM, 122, 10);
});

void test('priority flood caps a peak that dominates its window', () => {
  const result = peakTerrain(
    gridAround(lon, lat, cone(0, 0, 2_000, 0.1)),
    lon,
    lat,
  )!;
  assert.equal(result.capped, true);
  // The highest edge cell is 3 km away on an axis.
  near(result.prominenceM, 300, 5);

  const island = peakTerrain(
    gridAround(lon, lat, (e, n) =>
      Math.hypot(e, n) > 500 ? Number.NaN : 1_000 - 0.1 * Math.hypot(e, n),
    ),
    lon,
    lat,
  )!;
  assert.equal(island.capped, true);
});

void test('measureTerrain stores decimetre metrics for passes and peaks only', async () => {
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
      subtypes: ['natural_saddle'],
      display_name: 'Pass',
    },
    {
      ...base,
      osm_id: '2',
      kinds: ['peak'],
      subtypes: ['peak'],
      display_name: 'Peak',
      pass_amp_m: 3,
    },
    {
      ...base,
      osm_id: '3',
      kinds: ['hut'],
      subtypes: ['alpine_hut'],
      display_name: 'Hut',
    },
  ];
  const measured = await measureTerrain(
    rows,
    syntheticDem((e, n) => 1_000.04 + 0.00002 * (n * n - e * e)),
  );
  assert.equal(measured[0]!.dem_elevation_m, 1_000);
  assert(measured[0]!.pass_amp_m! > 100);
  assert.equal(measured[0]!.peak_prominence_m, undefined);
  // A stale metric of another kind is removed.
  assert.equal(measured[1]!.pass_amp_m, undefined);
  assert.equal(measured[1]!.peak_prominence_capped, false);
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
  assert.equal(longitudeSpacing(49.9), 1 / 3600);
  near(longitudeSpacing(-55), 1.5 / 3600, 1e-15);
});
