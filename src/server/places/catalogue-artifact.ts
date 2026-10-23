import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { type CoverageGeometry, parseCoverageGeometry } from './coverage';
import { NORMALIZATION_VERSION, PLACE_SELECTORS } from './normalize-source';
import { type NormalizedPlace, normalizedPlaceSchema } from './types';

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
const countsSchema = z.strictObject({
  total: count.positive(),
  by_kind: z.strictObject({ peak: count, pass: count, hut: count }),
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
});

export const catalogueManifestSchema = z.strictObject({
  format_version: z.literal(CATALOGUE_FORMAT_VERSION),
  catalogue_snapshot_id: z.string().regex(/^osm-places-v1:[0-9a-f]{64}$/),
  normalization_version: z.literal(NORMALIZATION_VERSION),
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
  counts: countsSchema,
  artifact: z.strictObject({
    file: z.literal('places.jsonl'),
    sha256: hash,
    bytes: count.positive(),
  }),
});
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
>;
export interface ValidatedCatalogue {
  manifest: CatalogueManifest;
  rows: NormalizedPlace[];
  coverage: CoverageGeometry;
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
    }),
  )}`;
}
export function serializeCatalogueRows(
  rows: readonly NormalizedPlace[],
): string {
  return `${rows.map(canonicalJson).join('\n')}\n`;
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
  for (const row of rows) {
    for (const kind of row.kinds) result.by_kind[kind]++;
    for (const subtype of row.subtypes) result.by_subtype[subtype]++;
    result.by_osm_type[row.osm_type]++;
    if (row.point_derivation === 'validated_polygon_interior')
      result.derived_hut_points++;
    if (!row.names.name?.trim() && !row.names.int_name?.trim())
      result.localized_only_names++;
  }
  return result;
}

/** Revalidate even typed callers; the importer must not trust a TypeScript cast. */
export function validateCatalogue(value: unknown): ValidatedCatalogue {
  const input = z
    .strictObject({
      manifest: catalogueManifestSchema,
      rows: z.array(normalizedPlaceSchema).min(1).max(100_000),
      coverage: z.unknown(),
    })
    .parse(value);
  const coverage = parseCoverageGeometry(input.coverage);
  const { manifest, rows } = input;
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
  return { manifest, rows, coverage };
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
  });
}
