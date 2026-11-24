import { z } from 'zod';

import { catalogueRegionSchema } from './catalogue-artifact';

/**
 * Geofabrik's machine-readable list of extracts: ID, parent, download URLs
 * and boundary of every region it serves. Catalogue regions are chosen from
 * it (`region-selection.ts`), and downloads stay on download.geofabrik.de.
 */
export const GEOFABRIK_INDEX_URL =
  'https://download.geofabrik.de/index-v1.json';

type Position = [number, number];
export type GeofabrikExtract = {
  /** Geofabrik's ID, such as `switzerland` or `us/california`. */
  id: string;
  /** The catalogue region ID: Geofabrik's with `/` as `-`. */
  region: string;
  parent: string | null;
  /** A country extract (it has an ISO 3166-1 code), a part of one (a child
   * of a country that is not one of its composite special regions), or
   * neither (continents and composites). */
  kind: 'country' | 'subregion' | 'other';
  countries: readonly string[];
  /** The `-latest` PBF and the `.poly` boundary. */
  pbf: string;
  poly: string;
  /** The boundary as GeoJSON MultiPolygon coordinates (the `.poly` file's
   * rings, split at the antimeridian). */
  boundary: Position[][][];
  bbox: [west: number, south: number, east: number, north: number];
};
export type GeofabrikIndex = {
  extracts: readonly GeofabrikExtract[];
  byRegion: ReadonlyMap<string, GeofabrikExtract>;
};

const downloadUrl = (suffix: RegExp) =>
  z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'download.geofabrik.de' &&
      !url.port &&
      !url.search &&
      suffix.test(url.pathname)
    );
  }, 'Expected a download.geofabrik.de file');
const position = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const featureSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    id: z.string().min(1).max(128),
    parent: z.string().min(1).nullish(),
    urls: z.object({
      pbf: downloadUrl(/-latest\.osm\.pbf$/),
      poly: downloadUrl(/\.poly$/),
    }),
    'iso3166-1:alpha2': z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
    special_regions: z.array(z.string()).optional(),
  }),
  geometry: z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(position).min(4)).min(1)).min(1),
  }),
});
const indexSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(featureSchema).min(1),
});

/** Validate the index. Fails on a parent it does not list and on two
 * extracts that would share a region ID. */
export function parseGeofabrikIndex(value: unknown): GeofabrikIndex {
  const features = indexSchema.parse(value).features;
  const byId = new Map(
    features.map((feature) => [feature.properties.id, feature]),
  );
  if (byId.size !== features.length)
    throw new Error('The Geofabrik index lists an extract twice');
  const byRegion = new Map<string, GeofabrikExtract>();
  const extracts = features.map(({ properties, geometry }) => {
    const { id } = properties;
    const parent = properties.parent ?? null;
    const parentFeature = parent === null ? undefined : byId.get(parent);
    if (parent !== null && !parentFeature)
      throw new Error(`Geofabrik extract ${id} has an unknown parent`);
    const region = catalogueRegionSchema.safeParse(id.replaceAll('/', '-'));
    if (!region.success)
      throw new Error(`Geofabrik extract ${id} has no valid region ID`);
    const countries = properties['iso3166-1:alpha2'] ?? [];
    const bbox: GeofabrikExtract['bbox'] = [180, 90, -180, -90];
    for (const [lon, lat] of geometry.coordinates.flat(2)) {
      bbox[0] = Math.min(bbox[0], lon);
      bbox[1] = Math.min(bbox[1], lat);
      bbox[2] = Math.max(bbox[2], lon);
      bbox[3] = Math.max(bbox[3], lat);
    }
    const extract: GeofabrikExtract = {
      id,
      region: region.data,
      parent,
      kind: countries.length
        ? 'country'
        : parentFeature?.properties['iso3166-1:alpha2']?.length &&
            !parentFeature.properties.special_regions?.includes(id)
          ? 'subregion'
          : 'other',
      countries,
      pbf: properties.urls.pbf,
      poly: properties.urls.poly,
      boundary: geometry.coordinates,
      bbox,
    };
    const other = byRegion.get(extract.region);
    if (other)
      throw new Error(
        `Geofabrik extracts ${other.id} and ${id} share region ID ${extract.region}`,
      );
    byRegion.set(extract.region, extract);
    return extract;
  });
  return { extracts, byRegion };
}

export async function fetchGeofabrikIndex(
  fetcher: typeof fetch = fetch,
): Promise<GeofabrikIndex> {
  const response = await fetcher(GEOFABRIK_INDEX_URL, {
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(`Reading the Geofabrik index failed (${response.status})`);
  return parseGeofabrikIndex(await response.json());
}

/** The extract of one day (`YYMMDD`, UTC). Geofabrik serves dated files
 * itself, while `-latest` may redirect to a mirror. */
export function datedPbfUrl(
  extract: Pick<GeofabrikExtract, 'pbf'>,
  date: string,
) {
  if (!/^\d{6}$/.test(date)) throw new Error('Expected a YYMMDD date');
  return extract.pbf.replace(/-latest\.osm\.pbf$/, `-${date}.osm.pbf`);
}

/** The size of a Geofabrik file, or null when it does not exist. Any other
 * answer fails, a redirect included. */
export async function geofabrikFileSize(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  if (!url.startsWith('https://download.geofabrik.de/'))
    throw new Error('Expected a download.geofabrik.de URL');
  const response = await fetcher(url, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 404) return null;
  const bytes = Number(response.headers.get('content-length'));
  if (response.status !== 200 || !Number.isSafeInteger(bytes) || bytes <= 0)
    throw new Error(`Geofabrik answered ${response.status} for ${url}`);
  return bytes;
}

/** Days before today tried for an epoch: Geofabrik publishes a day's
 * extracts during the following day, region by region. */
export const EPOCH_DAYS_BACK = { first: 2, last: 7 } as const;

/** The dates (`YYMMDD`, UTC) tried for an epoch, newest first. */
export function epochCandidates(today: Date) {
  const dates: string[] = [];
  for (let back = EPOCH_DAYS_BACK.first; back <= EPOCH_DAYS_BACK.last; back++) {
    const day = new Date(today.getTime() - back * 86_400_000);
    dates.push(day.toISOString().slice(2, 10).replaceAll('-', ''));
  }
  return dates;
}

/**
 * The newest of `dates` for which every extract's dated PBF exists, so all
 * regions share one source timestamp (`combine` requires it; every extract
 * of a day is cut from the same planet state). Fails with the regions
 * missing on the oldest date.
 */
export async function selectEpoch(input: {
  extracts: readonly GeofabrikExtract[];
  dates: readonly string[];
  exists: (url: string) => Promise<boolean>;
  concurrency?: number;
}) {
  let missing: string[] = [];
  for (const date of input.dates) {
    const found = await mapLimited(
      input.extracts,
      input.concurrency ?? 8,
      (extract) => input.exists(datedPbfUrl(extract, date)),
    );
    missing = input.extracts
      .filter((_, index) => !found[index])
      .map((extract) => extract.region)
      .sort();
    if (!missing.length) return date;
  }
  throw new Error(
    `No date from ${input.dates[0]} to ${input.dates.at(-1)} has every region's extract; missing on ${input.dates.at(-1)}: ${missing.join(', ')}`,
  );
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!);
      }
    }),
  );
  return results;
}
