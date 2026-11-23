import { coverageContains, coveragePolygons } from './batch-coverage';
import { canonicalJson } from './catalogue-artifact';
import type { CoverageGeometry } from './coverage';
import {
  EARTH_RADIUS_M,
  type Vector,
  subdivide,
  vector,
} from './spatial-index';

const TILES_PER_DEGREE = 4;
const X_TILES = 360 * TILES_PER_DEGREE;
const Y_TILES = 180 * TILES_PER_DEGREE;
/** `subdivide` splits arcs into pieces of at most this length. */
const SAMPLE_SPACING_M = 500;
/** Floating-point and sphere slack on top of the clearance. */
const SLACK_M = 10;

const key = ([x, y]: readonly [number, number]) => `${x},${y}`;
const wrapX = (x: number) => ((x % X_TILES) + X_TILES) % X_TILES;

/**
 * The catalogue tiles (`tileOf`, quarter degrees) whose recordings may be
 * judged covered differently after the coverage changes, so that only their
 * activities are matched again.
 *
 * A section is covered when it starts inside the coverage and stays
 * `clearanceM` away from its boundary (`createBatchCoverage`). If that answer
 * differs between two coverages, some point of the track lies within
 * `clearanceM` of the changed area D (the points inside exactly one of
 * them), and the activity's tiles include that point's tile. So every tile
 * that comes within `clearanceM` of D is returned; a few more do no harm.
 *
 * D is bounded by the changed edges: the directed boundary edges of one
 * coverage that the other lacks. A shared edge with the same direction has
 * the inside on the same side in both, so membership flips identically
 * across it. Tiles are found in two steps:
 *
 * 1. Every tile within `clearanceM` of a changed edge. Each edge is sampled
 *    every 500 m or less and every tile touching a cap around a sample point
 *    is taken, with the cap's radius covering the half spacing; no part of
 *    an edge falls between samples, however thin the sliver it bounds.
 * 2. A flood fill from those tiles into neighbouring tiles that lie inside
 *    D. A tile outside step 1 touches no changed edge, so membership in D is
 *    the same everywhere in it and its centre decides. Every tile of D that
 *    step 1 missed is joined to a step-1 tile by a chain of such tiles (walk
 *    inside D to D's boundary), and a tile within `clearanceM` of D that
 *    step 1 missed lies in D itself (the path to D crosses no changed edge).
 */
export function coverageChangeTiles(
  previous: CoverageGeometry,
  next: CoverageGeometry,
  clearanceM: number,
): string[] {
  if (canonicalJson(previous) === canonicalJson(next)) return [];
  const edges = changedEdges(previous, next);
  const tiles = new Set<string>();
  const queue: [number, number][] = [];
  const reach = (clearanceM + SAMPLE_SPACING_M / 2 + SLACK_M) / EARTH_RADIUS_M;
  for (const [a, b] of edges)
    for (const point of subdivide(vector(a), vector(b)))
      for (const tile of capTiles(point, reach))
        if (!tiles.has(key(tile))) {
          tiles.add(key(tile));
          queue.push(tile);
        }

  const before = coveragePolygons(previous);
  const after = coveragePolygons(next);
  const tested = new Set(tiles);
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const tile: [number, number] = [wrapX(x + dx), y + dy];
        if (tile[1] < 0 || tile[1] >= Y_TILES || tested.has(key(tile)))
          continue;
        tested.add(key(tile));
        const centre = vector([
          (tile[0] + 0.5) / TILES_PER_DEGREE - 180,
          (tile[1] + 0.5) / TILES_PER_DEGREE - 90,
        ]);
        if (
          coverageContains(before, centre) !== coverageContains(after, centre)
        ) {
          tiles.add(key(tile));
          queue.push(tile);
        }
      }
  }
  return [...tiles].sort();
}

type Position = [number, number];

/** Directed edges in one coverage and not the other (rings are normalised
 * to the right-hand rule, so the inside is always on the left). */
function changedEdges(a: CoverageGeometry, b: CoverageGeometry) {
  const counts = new Map<string, { edge: [Position, Position]; n: number }>();
  const add = (coverage: CoverageGeometry, sign: 1 | -1) => {
    for (const polygon of coverage.coordinates)
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          const edge = [ring[i - 1], ring[i]] as [Position, Position];
          const id = JSON.stringify(edge);
          const entry = counts.get(id) ?? { edge, n: 0 };
          entry.n += sign;
          counts.set(id, entry);
        }
  };
  add(a, 1);
  add(b, -1);
  return [...counts.values()]
    .filter((entry) => entry.n !== 0)
    .map((entry) => entry.edge);
}

/** The tiles touching the latitude/longitude box around the spherical cap
 * of angular radius `reach` centred on `point`. */
function* capTiles(point: Vector, reach: number) {
  const lat = Math.asin(Math.max(-1, Math.min(1, point[2])));
  const lon = Math.atan2(point[1], point[0]);
  const degrees = 180 / Math.PI;
  const south = Math.max(-90, (lat - reach) * degrees);
  const north = Math.min(90, (lat + reach) * degrees);
  // A cap that does not reach a pole spans asin(sin r / cos lat) of
  // longitude on either side; one that does spans every longitude.
  const halfWidth =
    Math.abs(lat) + reach < Math.PI / 2
      ? Math.asin(Math.min(1, Math.sin(reach) / Math.cos(lat))) * degrees
      : 180;
  const west = lon * degrees - halfWidth;
  const east = lon * degrees + halfWidth;
  const xs =
    halfWidth >= 180
      ? { from: 0, to: X_TILES - 1 }
      : {
          from: Math.floor((west + 180) * TILES_PER_DEGREE),
          to: Math.floor((east + 180) * TILES_PER_DEGREE),
        };
  const yFrom = Math.max(0, Math.floor((south + 90) * TILES_PER_DEGREE));
  const yTo = Math.min(
    Y_TILES - 1,
    Math.floor((north + 90) * TILES_PER_DEGREE),
  );
  for (let x = xs.from; x <= xs.to; x++)
    for (let y = yFrom; y <= yTo; y++) yield [wrapX(x), y] as [number, number];
}
