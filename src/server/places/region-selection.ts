import polygonClipping from 'polygon-clipping';
import { z } from 'zod';

import { COVERAGE_EDGE_BUDGET, coverageEdgeCount } from './batch-coverage';
import {
  type CatalogueManifest,
  MAX_CATALOGUE_REGIONS,
  catalogueRegionSchema,
} from './catalogue-artifact';
import { unionCatalogueCoverage } from './catalogue-combine';
import { parseCoverageGeometry } from './coverage';
import {
  type GeofabrikExtract,
  type GeofabrikIndex,
  datedPbfUrl,
} from './geofabrik-index';

/**
 * Which Geofabrik extracts the live catalogue is built from: the regions it
 * holds now (they stay), the regions activities are in, and a committed
 * override file. Tiles locate users' activities: they never leave this
 * module, and nothing it returns or throws names one.
 */

/** A tile demands regions when this many activities read it. Demand is
 * counted per tile, so one stray recording does not pull in a country. */
export const DEMAND_MIN_ACTIVITIES = 2;
/** A country extract larger than this is taken as its parts (US states,
 * Canadian provinces), keeping each prepare job within one runner's disk and
 * time. France (5.1 GB) and Germany (4.9 GB) stay whole. */
export const REGION_SIZE_CAP_BYTES = 6_000_000_000;

export type RegionReason = 'live' | 'demand' | 'include';
export type SelectedRegion = {
  region: string;
  reason: RegionReason;
  extract: GeofabrikExtract;
};
/** Manual changes to the selection, by region ID. `exclude` is the only way
 * a region leaves the catalogue. */
export const regionOverridesSchema = z.strictObject({
  include: z.array(catalogueRegionSchema),
  exclude: z.array(catalogueRegionSchema),
});
export type RegionOverrides = z.infer<typeof regionOverridesSchema>;

/** The regions a catalogue was built from. */
export function manifestRegions(manifest: CatalogueManifest) {
  if (manifest.components)
    return manifest.components.map((component) => component.region_id);
  if (!manifest.region_id) throw new Error('The catalogue names no region');
  return [manifest.region_id];
}

type Box = [west: number, south: number, east: number, north: number];

/** The quarter-degree squares of the tiles at least
 * `DEMAND_MIN_ACTIVITIES` activities read (`tileOf`). */
function demandedSquares(demand: ReadonlyMap<string, number>): Box[] {
  const squares: Box[] = [];
  for (const [tile, activities] of demand) {
    const match = /^(\d{1,4}),(\d{1,3})$/.exec(tile);
    const x = Number(match?.[1]),
      y = Number(match?.[2]);
    if (!match || x >= 1440 || y > 720)
      throw new Error('Malformed demand tile');
    if (activities >= DEMAND_MIN_ACTIVITIES)
      squares.push([
        x / 4 - 180,
        y / 4 - 90,
        (x + 1) / 4 - 180,
        (y + 1) / 4 - 90,
      ]);
  }
  return squares;
}

/** Whether a segment meets a closed box (Liang–Barsky). */
function segmentMeetsBox(
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  [west, south, east, north]: Box,
) {
  let enter = 0,
    leave = 1;
  for (const [p, q] of [
    [x1 - x2, x1 - west],
    [x2 - x1, east - x1],
    [y1 - y2, y1 - south],
    [y2 - y1, north - y1],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}

function ringContains(
  ring: readonly [number, number][],
  [x, y]: [number, number],
) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!,
      [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Whether a square and an extract's boundary share area. Only a square the
 * boundary passes through needs the polygon intersection; any other lies
 * wholly inside or outside. */
export function squareIntersects(extract: GeofabrikExtract, square: Box) {
  const [west, south, east, north] = square;
  if (
    extract.bbox[0] > east ||
    extract.bbox[2] < west ||
    extract.bbox[1] > north ||
    extract.bbox[3] < south
  )
    return false;
  const crossed = extract.boundary.some((polygon) =>
    polygon.some((ring) =>
      ring.some(
        (point, i) => i > 0 && segmentMeetsBox(ring[i - 1]!, point, square),
      ),
    ),
  );
  if (!crossed) {
    const centre: [number, number] = [(west + east) / 2, (south + north) / 2];
    return extract.boundary.some(
      ([outer, ...holes]) =>
        ringContains(outer!, centre) &&
        !holes.some((hole) => ringContains(hole, centre)),
    );
  }
  return (
    polygonClipping.intersection(extract.boundary, [
      [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    ]).length > 0
  );
}

/**
 * The wanted regions, sorted by region ID, each with why it is wanted:
 *
 * - `live`: every region of the live catalogue stays (sticky).
 * - `include`: added by the override file.
 * - `demand`: a country extract that a demanded tile intersects. A country
 *   above `capBytes` is taken as its parts that a demanded tile intersects.
 *   The choice sticks: a country the live catalogue (or the override file)
 *   holds whole stays whole, and one it holds any part of is extended by
 *   parts. `sizes` is asked only about countries that decide neither way.
 *
 * `exclude` removes a region whatever the reason. A region the live
 * catalogue holds but the index no longer lists fails, unless excluded; so
 * does an override naming an unknown region.
 */
export async function selectRegions(input: {
  index: GeofabrikIndex;
  live: readonly string[];
  /** Activities per tile (`readDemandTiles`); null to add no demanded region. */
  demand: ReadonlyMap<string, number> | null;
  overrides: RegionOverrides;
  sizes: (extract: GeofabrikExtract) => Promise<number>;
  capBytes?: number;
}) {
  const { index } = input;
  const live = new Set(input.live);
  const include = new Set(input.overrides.include);
  const exclude = new Set(input.overrides.exclude);
  for (const region of exclude)
    if (!index.byRegion.has(region) && !live.has(region))
      throw new Error(`Unknown region in the exclude overrides: ${region}`);
  for (const region of include) {
    const extract = index.byRegion.get(region);
    if (!extract)
      throw new Error(`Unknown region in the include overrides: ${region}`);
    if (extract.kind === 'other')
      throw new Error(
        `Only a country or a part of one can be included: ${region}`,
      );
  }

  const selected = new Map<string, SelectedRegion>();
  const excluded = new Set<string>();
  const add = (extract: GeofabrikExtract, reason: RegionReason) => {
    if (exclude.has(extract.region)) excluded.add(extract.region);
    else if (!selected.has(extract.region))
      selected.set(extract.region, { region: extract.region, reason, extract });
  };
  for (const region of [...live].sort()) {
    const extract = index.byRegion.get(region);
    if (extract) add(extract, 'live');
    else if (exclude.has(region)) excluded.add(region);
    else
      throw new Error(
        `Live catalogue region ${region} is not in the Geofabrik index; exclude it to remove it`,
      );
  }
  for (const region of [...include].sort())
    add(index.byRegion.get(region)!, 'include');

  if (input.demand) {
    const squares = demandedSquares(input.demand);
    const parts = new Map<string, GeofabrikExtract[]>();
    for (const extract of index.extracts)
      if (extract.kind === 'subregion')
        parts.set(extract.parent!, [
          ...(parts.get(extract.parent!) ?? []),
          extract,
        ]);
    const held = new Set([...live, ...include]);
    const demanded = index.extracts.flatMap((country) => {
      if (country.kind !== 'country') return [];
      const hits = squares.filter((square) =>
        squareIntersects(country, square),
      );
      return hits.length
        ? [{ country, hits, parts: parts.get(country.id) ?? [] }]
        : [];
    });
    const split = new Map<string, boolean>();
    const undecided = demanded.filter(({ country, parts }) => {
      if (held.has(country.region)) split.set(country.region, false);
      else if (exclude.has(country.region)) excluded.add(country.region);
      else if (parts.some((part) => held.has(part.region)))
        split.set(country.region, true);
      else return true;
      return false;
    });
    const sizes = await Promise.all(
      undecided.map(({ country }) => input.sizes(country)),
    );
    undecided.forEach(({ country, parts }, i) =>
      split.set(
        country.region,
        sizes[i]! > (input.capBytes ?? REGION_SIZE_CAP_BYTES) &&
          parts.length > 0,
      ),
    );
    for (const { country, hits, parts } of demanded) {
      const isSplit = split.get(country.region);
      if (isSplit === false) add(country, 'demand');
      else if (isSplit)
        for (const part of parts)
          if (hits.some((square) => squareIntersects(part, square)))
            add(part, 'demand');
    }
  }

  const regions = [...selected.values()].sort((a, b) =>
    a.region < b.region ? -1 : a.region > b.region ? 1 : 0,
  );
  const count = (reason: RegionReason) =>
    regions.filter((region) => region.reason === reason).length;
  return {
    regions,
    added: regions
      .filter(({ region }) => !live.has(region))
      .map(({ region }) => region),
    counts: {
      live: count('live'),
      demanded: count('demand'),
      included: count('include'),
      excluded: excluded.size,
    },
  };
}

/** Of the boundary edges a match can index, the share regions may fill:
 * the rest is room for boundaries that grow from one week to the next. */
const COVERAGE_EDGE_SHARE = 0.8;

export type SkippedRegion = {
  region: string;
  /** `coverage`: with it the combined coverage is not valid or has too many
   * edges to match against. `limit`: the catalogue holds no more regions. */
  reason: 'coverage' | 'limit';
};

/**
 * Drop the newly demanded regions the serving catalogue cannot take, so one
 * of them cannot stop the refresh of the others: a region whose boundary
 * makes the combined coverage invalid or larger than a match can index, and any region beyond
 * the number a catalogue combines. Live and included regions are never
 * dropped; if they do not fit, combining them fails and says why.
 */
export function servableRegions(
  selection: Awaited<ReturnType<typeof selectRegions>>,
  limits: { edges?: number; regions?: number } = {},
) {
  const maxEdges = limits.edges ?? COVERAGE_EDGE_BUDGET * COVERAGE_EDGE_SHARE;
  const maxRegions = limits.regions ?? MAX_CATALOGUE_REGIONS;
  const coverageOf = ({ extract }: SelectedRegion) =>
    parseCoverageGeometry({
      type: 'MultiPolygon',
      coordinates: extract.boundary,
    });
  const held = selection.regions.filter(({ reason }) => reason !== 'demand');
  let coverage = held.length
    ? unionCatalogueCoverage(held.map(coverageOf))
    : null;
  let kept = held.length;
  const skipped: SkippedRegion[] = [];
  for (const region of selection.regions) {
    if (region.reason !== 'demand') continue;
    if (kept >= maxRegions) {
      skipped.push({ region: region.region, reason: 'limit' });
      continue;
    }
    try {
      const next = unionCatalogueCoverage(
        coverage ? [coverage, coverageOf(region)] : [coverageOf(region)],
      );
      if (coverageEdgeCount(next) > maxEdges) throw new Error('Too many edges');
      coverage = next;
      kept++;
    } catch {
      skipped.push({ region: region.region, reason: 'coverage' });
    }
  }
  const dropped = new Set(skipped.map(({ region }) => region));
  const regions = selection.regions.filter(
    ({ region }) => !dropped.has(region),
  );
  return {
    regions,
    added: selection.added.filter((region) => !dropped.has(region)),
    counts: {
      ...selection.counts,
      demanded: selection.counts.demanded - skipped.length,
    },
    skipped,
  };
}

/** The `places:resolve` document: a GitHub Actions matrix can be built from
 * `regions` directly. Region IDs, URLs and counts only. */
export function resolvedRegionsDocument(
  selection: ReturnType<typeof servableRegions>,
  date: string,
) {
  return {
    date,
    regions: selection.regions.map(({ region, reason, extract }) => ({
      region,
      pbf: datedPbfUrl(extract, date),
      poly: extract.poly,
      reason,
    })),
    added: selection.added,
    skipped: selection.skipped,
    counts: selection.counts,
  };
}
