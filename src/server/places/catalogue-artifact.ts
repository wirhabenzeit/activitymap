import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { type CoverageGeometry, parseCoverageGeometry } from './coverage';
import {
  NORMALIZATION_VERSION,
  NORMALIZATION_VERSIONS,
  PLACE_SELECTORS,
} from './normalize-source';
import { PLACE_FILTER_POLICY, applyPlaceFilter } from './place-filter';
import {
  COPERNICUS_ATTRIBUTION,
  COPERNICUS_GLO30_URL,
  TERRAIN_METHOD,
} from './terrain';
import {
  type NormalizedPlace,
  PLACE_HIDDEN_REASONS,
  type PlaceHiddenReason,
  normalizedPlaceSchema,
} from './types';

export const CATALOGUE_FORMAT_VERSION = 1;
export const COVERAGE_NOTE =
  'Provider boundary downloaded with the snapshot, not a guaranteed historical boundary or strict national border. Complete crossing features can lie outside it; coverage completeness must be evaluated separately.';
export const CATALOGUE_ATTRIBUTION = {
  text: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
  license: 'ODbL-1.0',
} as const;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nonblank = z.string().trim().min(1);
const rawNonblank = z
  .string()
  .refine(
    (value) => value.trim().length > 0,
    'Expected a nonblank original name',
  );
const catalogueExclusionsSchema = z
  .array(
    z.strictObject({
      osm_type: z.enum(['way', 'relation']),
      osm_id: z.string().regex(/^[1-9][0-9]*$/),
      name: rawNonblank,
      reason: z.enum([
        'unsupported_peak_or_pass_area',
        'unsupported_hut_relation_type',
        'unsupported_hut_relation_members',
        'unsupported_hut_way_line',
      ]),
    }),
  )
  .max(1000);
/** Terrain method and filter policy of a v2 catalogue. Older method versions
 * stay valid so a published catalogue is readable after a code change. */
export function currentTerrainIdentity() {
  return {
    dem_url: COPERNICUS_GLO30_URL,
    dem_attribution: { ...COPERNICUS_ATTRIBUTION },
    method_version: TERRAIN_METHOD.version,
    method_sha256: sha256(canonicalJson(TERRAIN_METHOD)),
    filter_policy_version: PLACE_FILTER_POLICY.version,
    filter_policy_sha256: sha256(canonicalJson(PLACE_FILTER_POLICY)),
  };
}
const terrainSchema = z.strictObject({
  dem_url: z.url(),
  dem_attribution: z.strictObject({
    text: z.literal(COPERNICUS_ATTRIBUTION.text),
    url: z.literal(COPERNICUS_ATTRIBUTION.url),
  }),
  method_version: nonblank,
  method_sha256: hash,
  filter_policy_version: nonblank,
  filter_policy_sha256: hash,
});
const byKind = z.strictObject({ peak: count, pass: count, hut: count });
const filterCountsSchema = z.strictObject({
  hidden: count,
  hidden_by_kind: byKind,
  hidden_by_reason: z.strictObject(
    Object.fromEntries(
      PLACE_HIDDEN_REASONS.map((reason) => [reason, count]),
    ) as Record<PlaceHiddenReason, typeof count>,
  ),
  /** Passes and peaks outside the DEM, which no terrain rule can hide. */
  without_terrain: count,
});
const countsSchema = z.strictObject({
  total: count.positive(),
  by_kind: byKind,
  by_subtype: z.strictObject({
    peak: count,
    natural_saddle: count,
    road_trail_pass: count,
    alpine_hut: count,
    wilderness_hut: count,
  }),
  by_osm_type: z.strictObject({ node: count, way: count, relation: count }),
  derived_hut_points: count,
  localized_only_names: count,
  filter: filterCountsSchema.optional(),
});

export const catalogueRegionSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const catalogueManifestSchema = z.strictObject({
  region_id: catalogueRegionSchema.optional(),
  format_version: z.literal(CATALOGUE_FORMAT_VERSION),
  catalogue_snapshot_id: z.string().regex(/^osm-places-v1:[0-9a-f]{64}$/),
  normalization_version: z.enum(NORMALIZATION_VERSIONS),
  source: z.strictObject({
    provider: z.literal('Geofabrik'),
    url: z.url(),
    data_as_of: z.iso.datetime({ offset: true }),
    pbf_sha256: hash,
    pbf_bytes: count.positive(),
    selected_objects_sha256: hash,
    hut_points_sha256: hash,
    geometry_audit_sha256: hash,
    geometry_resolver_sha256: hash,
    selector_script_sha256: hash,
    exclusions: catalogueExclusionsSchema.optional(),
  }),
  coverage: z.strictObject({
    file: z.literal('coverage.geojson'),
    sha256: hash,
    poly_sha256: hash,
    source_url: z.url(),
    note: z.literal(COVERAGE_NOTE),
  }),
  toolchain: z.strictObject({ node: nonblank, icu: nonblank }),
  selectors: z
    .unknown()
    .refine(
      (value) => canonicalJson(value) === canonicalJson(PLACE_SELECTORS),
      'Unsupported source selectors',
    ),
  attribution: z.strictObject({
    text: z.literal(CATALOGUE_ATTRIBUTION.text),
    url: z.literal(CATALOGUE_ATTRIBUTION.url),
    license: z.literal(CATALOGUE_ATTRIBUTION.license),
  }),
  terrain: terrainSchema.optional(),
  counts: countsSchema,
  artifact: z.strictObject({
    file: z.literal('places.jsonl'),
    sha256: hash,
    bytes: count.positive(),
  }),
  components: z
    .array(
      z.strictObject({
        region_id: catalogueRegionSchema,
        snapshot_id: z.string().regex(/^osm-places-v1:[0-9a-f]{64}$/),
        source: z.strictObject({
          url: z.url(),
          data_as_of: z.iso.datetime({ offset: true }),
          pbf_sha256: hash,
          pbf_bytes: count.positive(),
          selector_script_sha256: hash,
          geometry_resolver_sha256: hash,
          exclusions: catalogueExclusionsSchema.optional(),
        }),
        coverage_sha256: hash,
        places_sha256: hash,
        count: count.positive(),
      }),
    )
    .min(2)
    .max(16)
    .optional(),
  deduplication: z
    .strictObject({
      policy: z.literal('same-osm-identity-and-version-v1'),
      duplicate_sources: count,
      duplicate_occurrences: count,
      file: z.literal('duplicates.jsonl'),
      sha256: hash,
      bytes: count,
    })
    .optional(),
});
export const catalogueDuplicateSchema = z.strictObject({
  osm_type: z.enum(['node', 'way', 'relation']),
  osm_id: z.string().regex(/^[1-9][0-9]*$/),
  osm_version: count.positive(),
  name: rawNonblank,
  regions: z.array(catalogueRegionSchema).min(2).max(16),
});
export type CatalogueDuplicate = z.infer<typeof catalogueDuplicateSchema>;
export type CatalogueManifest = z.infer<typeof catalogueManifestSchema>;
export type CatalogueIdentity = Pick<
  CatalogueManifest,
  | 'format_version'
  | 'normalization_version'
  | 'source'
  | 'coverage'
  | 'toolchain'
  | 'selectors'
  | 'attribution'
  | 'region_id'
  | 'components'
  | 'deduplication'
  | 'terrain'
>;
export interface ValidatedCatalogue {
  manifest: CatalogueManifest;
  rows: NormalizedPlace[];
  coverage: CoverageGeometry;
  duplicates?: CatalogueDuplicate[];
}

/** Canonical UTF-8 JSON; raw string values and safe own keys remain unchanged. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Nonfinite JSON value');
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Unsupported JSON value');
  return encoded;
}
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
export function catalogueSnapshotId(identity: CatalogueIdentity): string {
  const {
    format_version,
    normalization_version,
    source,
    coverage,
    toolchain,
    selectors,
    attribution,
    region_id,
    components,
    deduplication,
    terrain,
  } = identity;
  return `osm-places-v1:${sha256(
    canonicalJson({
      format_version,
      normalization_version,
      source,
      coverage,
      toolchain,
      selectors,
      attribution,
      ...(region_id === undefined ? {} : { region_id }),
      ...(components === undefined ? {} : { components }),
      ...(deduplication === undefined ? {} : { deduplication }),
      ...(terrain === undefined ? {} : { terrain }),
    }),
  )}`;
}
export function serializeCatalogueRows(
  rows: readonly NormalizedPlace[],
): string {
  return `${rows.map(canonicalJson).join('\n')}\n`;
}
export function serializeCatalogueDuplicates(
  rows: readonly CatalogueDuplicate[],
): string {
  return rows.length ? `${rows.map(canonicalJson).join('\n')}\n` : '';
}
export function catalogueCounts(
  rows: readonly NormalizedPlace[],
): z.infer<typeof countsSchema> {
  const result = {
    total: rows.length,
    by_kind: { peak: 0, pass: 0, hut: 0 },
    by_subtype: {
      peak: 0,
      natural_saddle: 0,
      road_trail_pass: 0,
      alpine_hut: 0,
      wilderness_hut: 0,
    },
    by_osm_type: { node: 0, way: 0, relation: 0 },
    derived_hut_points: 0,
    localized_only_names: 0,
  };
  const filter =
    rows[0]?.normalization_version === NORMALIZATION_VERSION
      ? {
          hidden: 0,
          hidden_by_kind: { peak: 0, pass: 0, hut: 0 },
          hidden_by_reason: Object.fromEntries(
            PLACE_HIDDEN_REASONS.map((reason) => [reason, 0]),
          ) as Record<PlaceHiddenReason, number>,
          without_terrain: 0,
        }
      : undefined;
  for (const row of rows) {
    if (filter) {
      if (row.hidden_reason) {
        filter.hidden++;
        filter.hidden_by_reason[row.hidden_reason]++;
        for (const kind of row.kinds) filter.hidden_by_kind[kind]++;
      }
      if (
        (row.kinds.includes('pass') && row.pass_amp_m === undefined) ||
        (row.kinds.includes('peak') && row.peak_prominence_m === undefined)
      )
        filter.without_terrain++;
    }
    for (const kind of row.kinds) result.by_kind[kind]++;
    for (const subtype of row.subtypes) result.by_subtype[subtype]++;
    result.by_osm_type[row.osm_type]++;
    if (row.point_derivation === 'validated_polygon_interior')
      result.derived_hut_points++;
    if (!row.names.name?.trim() && !row.names.int_name?.trim())
      result.localized_only_names++;
  }
  return filter ? { ...result, filter } : result;
}

/** Places read as candidates: all rows except those the filter hides. */
export function listedPlaceCount(manifest: Pick<CatalogueManifest, 'counts'>) {
  return manifest.counts.total - (manifest.counts.filter?.hidden ?? 0);
}

/** Revalidate even typed callers; the importer must not trust a TypeScript cast. */
export function validateCatalogue(value: unknown): ValidatedCatalogue {
  const input = z
    .strictObject({
      manifest: catalogueManifestSchema,
      rows: z.array(normalizedPlaceSchema).min(1).max(100_000),
      coverage: z.unknown(),
      duplicates: z.array(catalogueDuplicateSchema).max(100_000).optional(),
    })
    .parse(value);
  const coverage = parseCoverageGeometry(input.coverage);
  const { manifest, rows } = input;
  if (!!manifest.components !== !!manifest.deduplication)
    throw new Error(
      'Combined catalogue requires components and deduplication provenance',
    );
  if (manifest.components) {
    const regions = new Set(
      manifest.components.map((component) => component.region_id),
    );
    if (
      regions.size !== manifest.components.length ||
      !manifest.region_id ||
      input.duplicates === undefined
    )
      throw new Error(
        'Combined catalogue requires distinct input regions and its duplicate report',
      );
    if (
      manifest.components.some(
        (component) =>
          component.source.data_as_of !== manifest.source.data_as_of,
      )
    )
      throw new Error(
        'Combined catalogue inputs must share one snapshot timestamp',
      );
    const report = serializeCatalogueDuplicates(input.duplicates);
    const occurrences = input.duplicates.reduce(
      (sum, duplicate) => sum + duplicate.regions.length - 1,
      0,
    );
    const duplicateIds = new Set<string>();
    const bySource = new Map(
      rows.map((row) => [`${row.osm_type}/${row.osm_id}`, row]),
    );
    for (const duplicate of input.duplicates) {
      const key = `${duplicate.osm_type}/${duplicate.osm_id}`,
        row = bySource.get(key);
      if (
        duplicateIds.has(key) ||
        new Set(duplicate.regions).size !== duplicate.regions.length ||
        duplicate.regions.some((region) => !regions.has(region)) ||
        row?.osm_version !== duplicate.osm_version ||
        row?.display_name !== duplicate.name
      )
        throw new Error('Duplicate report disagrees with catalogue sources');
      duplicateIds.add(key);
    }
    if (
      manifest.deduplication!.duplicate_sources !== input.duplicates.length ||
      manifest.deduplication!.duplicate_occurrences !== occurrences ||
      manifest.components.reduce((sum, component) => sum + component.count, 0) -
        rows.length !==
        occurrences ||
      manifest.deduplication!.sha256 !== sha256(report) ||
      manifest.deduplication!.bytes !== Buffer.byteLength(report)
    )
      throw new Error('Duplicate report counts/hash do not match the manifest');
  } else if (input.duplicates !== undefined)
    throw new Error(
      'Unexpected duplicate report for a single-region catalogue',
    );
  const filtered = manifest.normalization_version === NORMALIZATION_VERSION;
  if (filtered !== !!manifest.terrain)
    throw new Error('Only a current-normalization catalogue declares terrain');
  if (
    manifest.terrain?.filter_policy_version === PLACE_FILTER_POLICY.version &&
    manifest.terrain.filter_policy_sha256 !==
      currentTerrainIdentity().filter_policy_sha256
  )
    throw new Error('Filter policy changed without a new version');
  if (manifest.catalogue_snapshot_id !== catalogueSnapshotId(manifest)) {
    throw new Error(
      'Catalogue snapshot identity does not match its provenance',
    );
  }
  if (sha256(`${canonicalJson(coverage)}\n`) !== manifest.coverage.sha256) {
    throw new Error('Coverage hash does not match the manifest');
  }
  const identities = new Set<string>();
  for (const row of rows) {
    const identity = `${row.osm_type}/${row.osm_id}`;
    if (identities.has(identity))
      throw new Error(`Duplicate source identity: ${identity}`);
    identities.add(identity);
    if (
      row.catalogue_snapshot_id !== manifest.catalogue_snapshot_id ||
      row.normalization_version !== manifest.normalization_version
    ) {
      throw new Error(
        `Source ${identity} belongs to another catalogue/normalization`,
      );
    }
    if (
      Date.parse(row.osm_updated_at) > Date.parse(manifest.source.data_as_of)
    ) {
      throw new Error(`Source ${identity} is newer than the declared snapshot`);
    }
    if (
      row.elevation_m !== undefined &&
      (!Number.isFinite(Math.fround(row.elevation_m)) ||
        (row.elevation_m !== 0 && Math.fround(row.elevation_m) === 0))
    ) {
      throw new Error(
        `Source ${identity} elevation cannot be stored as PostgreSQL real without overflow/underflow`,
      );
    }
  }
  if (
    !filtered &&
    rows.some(
      (row) =>
        row.hidden_reason !== undefined ||
        row.dem_elevation_m !== undefined ||
        row.pass_amp_m !== undefined ||
        row.peak_prominence_m !== undefined,
    )
  )
    throw new Error(
      'Legacy catalogue rows cannot carry terrain or filter data',
    );
  // Rows of the current policy must carry exactly its decisions.
  if (
    manifest.terrain?.filter_policy_version === PLACE_FILTER_POLICY.version &&
    applyPlaceFilter(rows).some(
      (row, index) => row.hidden_reason !== rows[index]!.hidden_reason,
    )
  )
    throw new Error('Catalogue hidden places disagree with the filter policy');
  if (canonicalJson(catalogueCounts(rows)) !== canonicalJson(manifest.counts)) {
    throw new Error('Catalogue category counts do not match the manifest');
  }
  const serialized = serializeCatalogueRows(rows);
  if (
    Buffer.byteLength(serialized) !== manifest.artifact.bytes ||
    sha256(serialized) !== manifest.artifact.sha256
  ) {
    throw new Error(
      'Catalogue rows do not match the manifest artifact hash/size',
    );
  }
  return {
    manifest,
    rows,
    coverage,
    ...(input.duplicates === undefined ? {} : { duplicates: input.duplicates }),
  };
}

async function readBounded(path: string, maxBytes: number): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maxBytes)
    throw new Error(`Artifact file too large or not regular: ${path}`);
  const bytes = await readFile(path);
  if (bytes.byteLength > maxBytes)
    throw new Error(`Artifact file grew beyond limit: ${path}`);
  return bytes.toString('utf8');
}
export async function loadCatalogueArtifact(
  directory: string,
): Promise<ValidatedCatalogue> {
  const manifest = catalogueManifestSchema.parse(
    JSON.parse(await readBounded(join(directory, 'manifest.json'), 1_048_576)),
  );
  const [contents, coverageText] = await Promise.all([
    readBounded(join(directory, manifest.artifact.file), 67_108_864),
    readBounded(join(directory, manifest.coverage.file), 2_097_152),
  ]);
  if (
    Buffer.byteLength(contents) !== manifest.artifact.bytes ||
    sha256(contents) !== manifest.artifact.sha256
  ) {
    throw new Error('Artifact file hash/size mismatch');
  }
  if (sha256(coverageText) !== manifest.coverage.sha256)
    throw new Error('Coverage file hash mismatch');
  if (!contents.endsWith('\n'))
    throw new Error('Expected newline-terminated canonical JSONL');
  const lines = contents.slice(0, -1).split('\n');
  if (lines.some((line) => !line.trim()))
    throw new Error('Blank catalogue JSONL row');
  return validateCatalogue({
    manifest,
    rows: lines.map((line) => JSON.parse(line) as unknown),
    coverage: JSON.parse(coverageText) as unknown,
    ...(manifest.deduplication
      ? {
          duplicates: await (async () => {
            const text = await readBounded(
              join(directory, manifest.deduplication!.file),
              67_108_864,
            );
            if (
              text &&
              (!text.endsWith('\n') ||
                text
                  .slice(0, -1)
                  .split('\n')
                  .some((line) => !line.trim()))
            )
              throw new Error('Invalid duplicate report JSONL');
            return text
              ? text
                  .slice(0, -1)
                  .split('\n')
                  .map((line) => JSON.parse(line) as unknown)
              : [];
          })(),
        }
      : {}),
  });
}
