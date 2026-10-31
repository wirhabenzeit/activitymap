import type { NormalizedPlace } from './types';

/**
 * Local terrain tests on one global DEM. Passes get a circle saddle test,
 * peaks a windowed prominence. Neither needs tiles, national models or a
 * global prominence run; both were evaluated against the per-country research
 * for issue #462 (`scripts/places/saddle-test` on the research branch).
 */
export const TERRAIN_METHOD = Object.freeze({
  version: 'glo30-circle-flood-v1',
  dem: 'copernicus-glo-30',
  passCircleRadiiM: Object.freeze([200, 400, 800, 1_500, 2_500]),
  passCircleSamples: 72,
  peakSnapM: 250,
  peakWindowM: 3_000,
  metresPerDegreeLatitude: 110_540,
  metresPerDegreeLongitudeAtEquator: 111_320,
});
export const COPERNICUS_GLO30_URL =
  'https://copernicus-dem-30m.s3.amazonaws.com/';
export const COPERNICUS_ATTRIBUTION = Object.freeze({
  text: '© DLR e.V. and Airbus, Copernicus programme',
  url: 'https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model',
});
/** Largest distance from a place that any test reads. */
export const TERRAIN_READ_RADIUS_M = Math.max(
  TERRAIN_METHOD.peakWindowM,
  TERRAIN_METHOD.passCircleRadiiM.at(-1)!,
);

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

export type PassTerrain = {
  /** DEM height at the node. */
  elevationM: number;
  ampM: number;
  radiusM: number;
};
export type PeakTerrain = {
  /** Highest DEM cell within the snap radius. */
  summitM: number;
  prominenceM: number;
  /** The flood reached the window edge first: prominence is a lower bound. */
  capped: boolean;
};

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
  let best: PassTerrain = { elevationM: centre, ampM: 0, radiusM: 0 };
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
    if (amp > best.ampM)
      best = { elevationM: centre, ampM: amp, radiusM: radius };
  }
  return best;
}

/** Max-heap of cell indices by height; ties pop the lower index first. */
class CellHeap {
  private heights: number[] = [];
  private cells: number[] = [];
  get size() {
    return this.cells.length;
  }
  private before(a: number, b: number) {
    return (
      this.heights[a]! > this.heights[b]! ||
      (this.heights[a] === this.heights[b] && this.cells[a]! < this.cells[b]!)
    );
  }
  private swap(a: number, b: number) {
    [this.heights[a], this.heights[b]] = [this.heights[b]!, this.heights[a]!];
    [this.cells[a], this.cells[b]] = [this.cells[b]!, this.cells[a]!];
  }
  push(height: number, cell: number) {
    this.heights.push(height);
    this.cells.push(cell);
    for (let i = this.cells.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): [height: number, cell: number] {
    const top: [number, number] = [this.heights[0]!, this.cells[0]!];
    const lastHeight = this.heights.pop()!,
      lastCell = this.cells.pop()!;
    if (this.cells.length) {
      this.heights[0] = lastHeight;
      this.cells[0] = lastCell;
      for (let i = 0; ;) {
        const left = 2 * i + 1,
          right = left + 1;
        let next = i;
        if (left < this.cells.length && this.before(left, next)) next = left;
        if (right < this.cells.length && this.before(right, next)) next = right;
        if (next === i) break;
        this.swap(i, next);
        i = next;
      }
    }
    return top;
  }
}

/**
 * Local prominence. Start at the highest cell within the snap radius and flood
 * downhill inside a square window, always taking the highest unvisited
 * neighbour (8-connected priority flood). The lowest height popped before a
 * cell higher than the start is the key col. If the flood reaches the window
 * edge first, the drop to that cell is a lower bound and marked capped.
 */
export function peakTerrain(
  grid: DemGrid,
  lon: number,
  lat: number,
): PeakTerrain | undefined {
  const scale = metresPerDegree(lat);
  const halfX = TERRAIN_METHOD.peakWindowM / scale.x / grid.dx,
    halfY = TERRAIN_METHOD.peakWindowM / scale.y / grid.dy;
  const cx = (lon - grid.west) / grid.dx,
    cy = (grid.north - lat) / grid.dy;
  const x0 = Math.max(0, Math.floor(cx - halfX)),
    x1 = Math.min(grid.width - 1, Math.ceil(cx + halfX)),
    y0 = Math.max(0, Math.floor(cy - halfY)),
    y1 = Math.min(grid.height - 1, Math.ceil(cy + halfY));
  const width = x1 - x0 + 1,
    height = y1 - y0 + 1;
  if (width < 3 || height < 3) return undefined;
  const value = (x: number, y: number) =>
    grid.values[(y0 + y) * grid.width + x0 + x]!;

  let start = -1,
    summit = -Infinity;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dxM = (x0 + x - cx) * grid.dx * scale.x,
        dyM = (y0 + y - cy) * grid.dy * scale.y;
      const z = value(x, y);
      if (Math.hypot(dxM, dyM) <= TERRAIN_METHOD.peakSnapM && z > summit) {
        summit = z;
        start = y * width + x;
      }
    }
  if (start < 0) return undefined;

  const seen = new Uint8Array(width * height);
  seen[start] = 1;
  const heap = new CellHeap();
  heap.push(summit, start);
  let col = summit,
    capped = true;
  while (heap.size) {
    const [z, cell] = heap.pop();
    if (z > summit) {
      capped = false;
      break;
    }
    col = Math.min(col, z);
    const x = cell % width,
      y = (cell - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) break;
    for (let ny = y - 1; ny <= y + 1; ny++)
      for (let nx = x - 1; nx <= x + 1; nx++) {
        const next = ny * width + nx;
        if (seen[next]) continue;
        seen[next] = 1;
        const neighbour = value(nx, ny);
        if (Number.isFinite(neighbour)) heap.push(neighbour, next);
      }
  }
  // An exhausted heap (an island of data) also leaves the value a lower bound.
  return { summitM: summit, prominenceM: summit - col, capped };
}

/** Decimetres, as stored: decisions read the same values a reader sees. */
const decimetres = (value: number) => Math.round(value * 10) / 10;

/**
 * Add DEM metrics to every pass and peak. Places are visited in spatial
 * order with a few windows in flight so a block cache sees each DEM block
 * while it is still warm. Places outside the DEM keep no metrics.
 */
export async function measureTerrain(
  rows: readonly NormalizedPlace[],
  dem: DemSource,
  options: {
    concurrency?: number;
    onProgress?: (message: string) => void;
  } = {},
): Promise<NormalizedPlace[]> {
  const result = [...rows];
  const pending = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) => row.kinds.includes('pass') || row.kinds.includes('peak'),
    )
    .sort(
      (a, b) =>
        Math.floor(b.row.location.latitude) -
          Math.floor(a.row.location.latitude) ||
        Math.floor(a.row.location.longitude) -
          Math.floor(b.row.location.longitude) ||
        b.row.location.latitude - a.row.location.latitude ||
        a.row.location.longitude - b.row.location.longitude,
    );
  let next = 0,
    done = 0;
  const worker = async () => {
    while (next < pending.length) {
      const { row, index } = pending[next++]!;
      const { longitude: lon, latitude: lat } = row.location;
      const grid = await dem.window(lon, lat, TERRAIN_READ_RADIUS_M);
      const place = { ...row };
      delete place.dem_elevation_m;
      delete place.pass_amp_m;
      delete place.peak_prominence_m;
      delete place.peak_prominence_capped;
      const pass = row.kinds.includes('pass')
        ? passTerrain(grid, lon, lat)
        : undefined;
      const peak = row.kinds.includes('peak')
        ? peakTerrain(grid, lon, lat)
        : undefined;
      const elevation = pass?.elevationM ?? peak?.summitM;
      result[index] = {
        ...place,
        ...(elevation === undefined
          ? {}
          : { dem_elevation_m: decimetres(elevation) }),
        ...(pass ? { pass_amp_m: decimetres(pass.ampM) } : {}),
        ...(peak
          ? {
              peak_prominence_m: decimetres(peak.prominenceM),
              peak_prominence_capped: peak.capped,
            }
          : {}),
      };
      if (++done % 5_000 === 0)
        options.onProgress?.(
          `Measured terrain for ${done}/${pending.length} places`,
        );
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 8 }, worker));
  return result;
}
