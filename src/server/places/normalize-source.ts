import { z } from 'zod';

import {
  type NormalizedPlace,
  PLACE_KINDS,
  type PlaceKind,
  type PlaceNames,
  type PlacePoint,
  type PlaceSubtype,
  normalizedPlaceSchema,
  placeTagsSchema,
} from './types';

export const NORMALIZATION_VERSION = 'osm-places-v1';
export const PLACE_SELECTORS = {
  peak: { natural: 'peak' },
  saddle: { natural: 'saddle' },
  mountain_pass: { mountain_pass: 'yes' },
  alpine_hut: { tourism: 'alpine_hut' },
  wilderness_hut: { tourism: 'wilderness_hut' },
} as const;

export interface SourceNormalizationContext {
  catalogueSnapshotId: string;
  normalizationVersion: string;
}

const rawTagsSchema = z.object({ tags: placeTagsSchema }).passthrough();
const sourceSchema = z
  .object({
    osm_type: normalizedPlaceSchema.shape.osm_type,
    osm_id: normalizedPlaceSchema.shape.osm_id,
    osm_version: normalizedPlaceSchema.shape.osm_version,
    osm_timestamp: normalizedPlaceSchema.shape.osm_updated_at,
    point: z.unknown().optional(),
    point_derivation: z.unknown().optional(),
  })
  .passthrough();
const sourcePointSchema = z.strictObject({
  lon: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90),
});
const hutPointSchema = sourceSchema.extend({
  status: z.literal('valid'),
  point: sourcePointSchema,
  point_derivation: z.enum(['osm_node', 'validated_polygon_interior']),
  geometry_type: z.enum(['Point', 'Polygon', 'MultiPolygon']),
});

const namePrefixes = new Set([
  'name',
  'int_name',
  'alt_name',
  'old_name',
  'loc_name',
  'official_name',
  'short_name',
]);
const languageNames = new Intl.DisplayNames(['en'], {
  type: 'language',
  fallback: 'none',
});
const excludedLanguages = new Set(['und', 'mul', 'zxx']);

/**
 * Conservative language recognition, not a regex pretending to be a registry.
 * The exporter records Node/ICU versions in its frozen artifact identity: ICU's
 * known-language data can change. Unknown codes and metadata are not names;
 * their original tags remain available for a later normalization policy.
 */
function recognizedLanguage(value: string): boolean {
  if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(value)) return false;
  try {
    const locale = new Intl.Locale(value.replaceAll('_', '-'));
    return (
      !excludedLanguages.has(locale.language) &&
      languageNames.of(locale.language) !== undefined
    );
  } catch {
    return false;
  }
}

function usableNames(tags: Record<string, string>): PlaceNames {
  return Object.fromEntries(
    Object.entries(tags).filter(([key, value]) => {
      if (!value.trim()) return false;
      const [prefix, language, ...otherParts] = key.split(':');
      return (
        namePrefixes.has(prefix!) &&
        otherParts.length === 0 &&
        (language === undefined || recognizedLanguage(language))
      );
    }),
  );
}

/** Match the audit's decimal/metres grammar, then the database's real storage. */
function elevationMetres(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!/^[+-]?[0-9]+(?:\.[0-9]+)?[ \t]*(?:m)?$/.test(value)) {
    return undefined;
  }
  const decimal = value.replace(/m$/, '').trim();
  const parsed = Number(decimal);
  const stored = Math.fround(parsed);
  // Reject overflow and nonzero underflow rather than changing the evidence to
  // Infinity or zero. Ordinary Float32 rounding is explicit and reproducible.
  if (!Number.isFinite(stored) || (stored === 0 && /[1-9]/.test(decimal))) {
    return undefined;
  }
  return Object.is(stored, -0) ? 0 : stored;
}

/**
 * Normalize one selected-source audit row. Selection and usable names are
 * recomputed from raw tags, never trusted from measurement convenience fields.
 * Returning null means unselected/unnamed; an eligible row with unusable
 * provenance or geometry throws so an exporter cannot silently shrink a load.
 * PBF/artifact hashes and audit algorithm versions are verified by the exporter.
 */
export function normalizeSourceObject(
  source: unknown,
  hutPoint: unknown,
  context: SourceNormalizationContext,
): NormalizedPlace | null {
  const { tags } = rawTagsSchema.parse(source);
  const subtypes: PlaceSubtype[] = [];
  const kinds = new Set<PlaceKind>();
  if (tags.natural === PLACE_SELECTORS.peak.natural) {
    subtypes.push('peak');
    kinds.add('peak');
  }
  if (tags.natural === PLACE_SELECTORS.saddle.natural) {
    subtypes.push('natural_saddle');
    kinds.add('pass');
  }
  if (tags.mountain_pass === PLACE_SELECTORS.mountain_pass.mountain_pass) {
    subtypes.push('road_trail_pass');
    kinds.add('pass');
  }
  if (tags.tourism === PLACE_SELECTORS.alpine_hut.tourism) {
    subtypes.push('alpine_hut');
    kinds.add('hut');
  }
  if (tags.tourism === PLACE_SELECTORS.wilderness_hut.tourism) {
    subtypes.push('wilderness_hut');
    kinds.add('hut');
  }
  if (!subtypes.length) return null;

  const names = usableNames(tags);
  // Default sort compares code points, independent of host locale/collation.
  const localized = Object.keys(names)
    .filter((key) => key.startsWith('name:'))
    .sort();
  const displayName =
    names.name ?? names.int_name ?? names['name:en'] ?? names[localized[0]!];
  if (displayName === undefined) return null;

  const record = sourceSchema.parse(source);
  const audit =
    hutPoint === undefined ? undefined : hutPointSchema.parse(hutPoint);
  if (
    audit &&
    (!kinds.has('hut') ||
      audit.osm_type !== record.osm_type ||
      audit.osm_id !== record.osm_id ||
      audit.osm_version !== record.osm_version ||
      audit.osm_timestamp !== record.osm_timestamp)
  ) {
    throw new Error(
      'Hut point must match the selected source identity and version',
    );
  }

  let location: PlacePoint;
  let pointDerivation: NormalizedPlace['point_derivation'];
  if (record.osm_type === 'node') {
    if (record.point_derivation !== 'osm_node') {
      throw new Error('Node requires its original OSM point');
    }
    const point = sourcePointSchema.parse(record.point);
    if (
      audit &&
      (audit.point_derivation !== 'osm_node' ||
        audit.geometry_type !== 'Point' ||
        audit.point.lon !== point.lon ||
        audit.point.lat !== point.lat)
    ) {
      throw new Error(
        'Direct hut point audit must match the original OSM point',
      );
    }
    location = { longitude: point.lon, latitude: point.lat };
    pointDerivation = 'osm_node';
  } else {
    if (
      !kinds.has('hut') ||
      audit?.point_derivation !== 'validated_polygon_interior' ||
      audit.geometry_type === 'Point'
    ) {
      throw new Error('Non-node source requires a validated hut polygon point');
    }
    location = { longitude: audit.point.lon, latitude: audit.point.lat };
    pointDerivation = 'validated_polygon_interior';
  }

  const elevation = elevationMetres(tags.ele);
  return normalizedPlaceSchema.parse({
    osm_type: record.osm_type,
    osm_id: record.osm_id,
    kinds: PLACE_KINDS.filter((kind) => kinds.has(kind)),
    subtypes,
    display_name: displayName,
    names,
    location,
    ...(elevation === undefined ? {} : { elevation_m: elevation }),
    tags,
    osm_version: record.osm_version,
    osm_updated_at: record.osm_timestamp,
    point_derivation: pointDerivation,
    normalization_version: context.normalizationVersion,
    catalogue_snapshot_id: context.catalogueSnapshotId,
  });
}
