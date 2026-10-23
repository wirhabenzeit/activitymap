/** Draft lookup adapter. No network calls happen on import. */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { type Feature, type Point, features } from '../matching';

export const PLACE_LOOKUP_VERSION = 'osm-places-v1-draft';
export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const SETTLEMENT_TYPES = ['city', 'town', 'village', 'hamlet'] as const;

export function placeKind(
  tags: Record<string, string>,
): Feature['kind'] | null {
  if (tags.mountain_pass === 'yes' || tags.natural === 'saddle') return 'pass';
  if (tags.natural === 'peak') return 'peak';
  if (['alpine_hut', 'wilderness_hut'].includes(tags.tourism ?? ''))
    return 'hut';
  if (!tags.aerialway && SETTLEMENT_TYPES.some((type) => type === tags.place))
    return 'place';
  return null;
}

export function routeBounds(points: Point[]) {
  if (
    points.length < 2 ||
    points.some(
      (p) =>
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lon) ||
        Math.abs(p.lat) > 90 ||
        Math.abs(p.lon) > 180,
    )
  )
    throw new Error('Invalid route coordinates');
  const bounds = {
    south: Math.max(-90, Math.min(...points.map((p) => p.lat)) - 0.045),
    north: Math.min(90, Math.max(...points.map((p) => p.lat)) + 0.045),
    west: Math.max(-180, Math.min(...points.map((p) => p.lon)) - 0.065),
    east: Math.min(180, Math.max(...points.map((p) => p.lon)) + 0.065),
  };
  if (bounds.north - bounds.south > 3 || bounds.east - bounds.west > 4)
    throw new Error('Route requires tiled lookup; bounding box too large');
  return bounds;
}

export function buildPlaceQuery(points: Point[]) {
  const b = routeBounds(points),
    box = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:20];(
nwr["name"]["natural"~"^(peak|saddle)$"](${box});
nwr["name"]["mountain_pass"="yes"](${box});
nwr["name"]["tourism"~"^(alpine_hut|wilderness_hut)$"](${box});
nwr["name"]["place"~"^(city|town|village|hamlet)$"](${box});
);out meta center;`;
}

const coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
const elementSchema = z.object({
  type: z.enum(['node', 'way', 'relation']),
  id: z.number().int().nonnegative().safe(),
  lat: coordinate.shape.lat.optional(),
  lon: coordinate.shape.lon.optional(),
  center: coordinate.optional(),
  version: z.number().int().positive().optional(),
  timestamp: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
const responseSchema = z.object({
  elements: z.array(elementSchema),
  remark: z.string().optional(),
  osm3s: z.object({ timestamp_osm_base: z.string().optional() }).optional(),
});
export type PlaceSnapshot = Feature & {
  osmVersion: number | null;
  osmUpdatedAt: string | null;
};
export type PlaceLookup = {
  places: PlaceSnapshot[];
  queryHash: string;
  osmTimestamp: string | null;
};
export interface LookupCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** Exact-query cache seam; persistent regional/tile reuse belongs in the worker. */
export async function fetchOsmPlaces(
  points: Point[],
  options: {
    fetch?: typeof fetch;
    cache?: LookupCache;
    signal?: AbortSignal;
  } = {},
): Promise<PlaceLookup> {
  const query = buildPlaceQuery(points);
  const queryHash = createHash('sha256')
    .update(`${PLACE_LOOKUP_VERSION}\n${OVERPASS_ENDPOINT}\n${query}`)
    .digest('hex');
  const decode = (raw: unknown) => {
    const parsed = responseSchema.parse(raw);
    if (parsed.remark)
      throw new Error(`Incomplete Overpass response: ${parsed.remark}`);
    return parsed;
  };
  let parsed: ReturnType<typeof decode>;
  const cached = await options.cache?.get(queryHash);
  if (cached !== undefined) parsed = decode(cached);
  else {
    const response = await (options.fetch ?? fetch)(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ActivityMap-place-inference-prototype/0.1',
      },
      body: new URLSearchParams({ data: query }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)])
        : AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    parsed = decode(await response.json());
    await options.cache?.set(queryHash, parsed);
  }
  const metadata = new Map(
    parsed.elements.map((e) => [`${e.type}/${e.id}`, e]),
  );
  const places = features(parsed.elements).flatMap((f) => {
    const kind = placeKind(f.tags);
    if (!kind) return [];
    const element = metadata.get(f.id)!;
    return [
      {
        ...f,
        kind,
        osmVersion: element.version ?? null,
        osmUpdatedAt: element.timestamp ?? null,
      },
    ];
  });
  return {
    places,
    queryHash,
    osmTimestamp: parsed.osm3s?.timestamp_osm_base ?? null,
  };
}
