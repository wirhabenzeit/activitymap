import type { NormalizedPlace } from './types';

/**
 * Circle saddle test on one global DEM for passes on minor roads, the only
 * places a terrain rule decides (see place-filter.ts). It needs no tiles,
 * national models or prominence run; it was evaluated against the per-country
 * research for issue #462 (`scripts/places/saddle-test` on the research branch).
 */
export const TERRAIN_METHOD = Object.freeze({
  version: 'glo30-road-pass-v1',
  dem: 'copernicus-glo-30',
  passCircleRadiiM: Object.freeze([200, 400, 800, 1_500, 2_500]),
  passCircleSamples: 72,
  metresPerDegreeLatitude: 110_540,
  metresPerDegreeLongitudeAtEquator: 111_320,
});
export const COPERNICUS_GLO30_URL =
  'https://copernicus-dem-30m.s3.amazonaws.com/';
export const COPERNICUS_ATTRIBUTION = Object.freeze({
  text: '© DLR e.V. and Airbus, Copernicus programme',
  url: 'https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model',
});
/** Largest distance from a place that the test reads. */
export const TERRAIN_READ_RADIUS_M = TERRAIN_METHOD.passCircleRadiiM.at(-1)!;

/**
 * A north-up raster on a regular lon/lat grid. Cell (0, 0) is centred on
 * (west, north); NaN marks missing data (sea tiles, voids).
 */
export interface DemGrid {
  west: number;
  north: number;
  /** Degrees per cell, both positive. */
  dx: number;
  dy: number;
  width: number;
  height: number;
  values: Float32Array;
}

/** Reads a terrain window around a point: synthetic in tests, Copernicus
 * COGs in preparation. */
export interface DemSource {
  window(lon: number, lat: number, radiusM: number): Promise<DemGrid>;
}

export type PassTerrain = { ampM: number; radiusM: number };

export function metresPerDegree(latitude: number) {
  return {
    x:
      TERRAIN_METHOD.metresPerDegreeLongitudeAtEquator *
      Math.cos((latitude * Math.PI) / 180),
    y: TERRAIN_METHOD.metresPerDegreeLatitude,
  };
}

/** Bilinear height; NaN outside the grid or next to missing data. */
export function bilinear(grid: DemGrid, lon: number, lat: number): number {
  const cx = (lon - grid.west) / grid.dx;
  const cy = (grid.north - lat) / grid.dy;
  const ix = Math.floor(cx),
    iy = Math.floor(cy);
  if (ix < 0 || iy < 0 || ix + 1 >= grid.width || iy + 1 >= grid.height) {
    // Exact hits on the last row/column are still inside the grid.
    if (
      cx === ix &&
      cy === iy &&
      ix >= 0 &&
      iy >= 0 &&
      ix < grid.width &&
      iy < grid.height
    )
      return grid.values[iy * grid.width + ix]!;
    return Number.NaN;
  }
  const fx = cx - ix,
    fy = cy - iy;
  const at = (x: number, y: number) => grid.values[y * grid.width + x]!;
  return (
    at(ix, iy) * (1 - fx) * (1 - fy) +
    at(ix + 1, iy) * fx * (1 - fy) +
    at(ix, iy + 1) * (1 - fx) * fy +
    at(ix + 1, iy + 1) * fx * fy
  );
}

/** Extremes of each circular run of `inside` samples. */
export function circularRunMaxima(
  inside: readonly boolean[],
  values: readonly number[],
): number[] {
  const n = inside.length;
  const outside = inside.indexOf(false);
  if (outside === -1) return n ? [Math.max(...values)] : [];
  const maxima: number[] = [];
  let current: number | undefined;
  // Start just after an outside sample so no run wraps around the end.
  for (let step = 1; step <= n; step++) {
    const index = (outside + step) % n;
    if (inside[index]) current = Math.max(current ?? -Infinity, values[index]!);
    else if (current !== undefined) {
      maxima.push(current);
      current = undefined;
    }
  }
  if (current !== undefined) maxima.push(current);
  return maxima;
}

const secondLargest = (values: number[]) =>
  values.length < 2 ? 0 : [...values].sort((a, b) => b - a)[1]!;

/**
 * Circle saddle test. A saddle rises above the node on two separate arcs (the
 * flanks) and falls below it on two others (the valleys). Per radius, rise is
 * the second-highest arc maximum above the node and drop the second-deepest
 * arc below it; amp = min(rise, drop). The best radius wins.
 */
export function passTerrain(
  grid: DemGrid,
  lon: number,
  lat: number,
): PassTerrain | undefined {
  const centre = bilinear(grid, lon, lat);
  if (!Number.isFinite(centre)) return undefined;
  const scale = metresPerDegree(lat);
  let best: PassTerrain = { ampM: 0, radiusM: 0 };
  const samples = TERRAIN_METHOD.passCircleSamples;
  for (const radius of TERRAIN_METHOD.passCircleRadiiM) {
    const differences: number[] = [];
    for (let index = 0; index < samples; index++) {
      const angle = (2 * Math.PI * index) / samples;
      differences.push(
        bilinear(
          grid,
          lon + (radius * Math.sin(angle)) / scale.x,
          lat + (radius * Math.cos(angle)) / scale.y,
        ) - centre,
      );
    }
    if (differences.some((value) => !Number.isFinite(value))) continue;
    const rise = secondLargest(
      circularRunMaxima(
        differences.map((value) => value > 0),
        differences,
      ),
    );
    const drop = secondLargest(
      circularRunMaxima(
        differences.map((value) => value < 0),
        differences.map((value) => -value),
      ),
    );
    const amp = Math.min(rise, drop);
    if (amp > best.ampM) best = { ampM: amp, radiusM: radius };
  }
  return best;
}

/** Decimetres, as stored: decisions read the same values a reader sees. */
const decimetres = (value: number) => Math.round(value * 10) / 10;

/**
 * Add `pass_amp_m` to the selected passes and clear it elsewhere. Passes are
 * visited in spatial order with a few windows in flight so a block cache sees
 * each DEM block while it is still warm. Passes outside the DEM get no amp.
 */
export async function measureTerrain(
  rows: readonly NormalizedPlace[],
  dem: DemSource,
  options: {
    select: (row: NormalizedPlace) => boolean;
    concurrency?: number;
    onProgress?: (message: string) => void;
  },
): Promise<NormalizedPlace[]> {
  const result = rows.map((row) => {
    if (row.pass_amp_m === undefined) return row;
    const place = { ...row };
    delete place.pass_amp_m;
    return place;
  });
  const pending = result
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.kinds.includes('pass') && options.select(row))
    .sort(
      (a, b) =>
        Math.floor(b.row.location.latitude) -
          Math.floor(a.row.location.latitude) ||
        Math.floor(a.row.location.longitude) -
          Math.floor(b.row.location.longitude) ||
        b.row.location.latitude - a.row.location.latitude ||
        a.row.location.longitude - b.row.location.longitude,
    );
  options.onProgress?.(`Measuring terrain for ${pending.length} road passes`);
  let next = 0,
    done = 0;
  const worker = async () => {
    while (next < pending.length) {
      const { row, index } = pending[next++]!;
      const { longitude: lon, latitude: lat } = row.location;
      const pass = passTerrain(
        await dem.window(lon, lat, TERRAIN_READ_RADIUS_M),
        lon,
        lat,
      );
      if (pass) result[index] = { ...row, pass_amp_m: decimetres(pass.ampM) };
      if (++done % 1_000 === 0)
        options.onProgress?.(
          `Measured terrain for ${done}/${pending.length} road passes`,
        );
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 8 }, worker));
  return result;
}
