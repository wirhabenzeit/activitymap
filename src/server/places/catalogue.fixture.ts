import {
  CATALOGUE_ATTRIBUTION,
  CATALOGUE_FORMAT_VERSION,
  COVERAGE_NOTE,
  type CatalogueIdentity,
  type ValidatedCatalogue,
  canonicalJson,
  catalogueCounts,
  catalogueSnapshotId,
  currentTerrainIdentity,
  serializeCatalogueRows,
  sha256,
  validateCatalogue,
} from './catalogue-artifact';
import { NORMALIZATION_VERSION, PLACE_SELECTORS } from './normalize-source';
import { applyPlaceFilter } from './place-filter';
import type { NormalizedPlace } from './types';

/** Tiny invented catalogue for unit/database proofs; no private activity data. */
export function createSyntheticCatalogue(
  options: {
    sourceSha256?: string;
    dataAsOf?: string;
    regionId?: string;
    transformRows?: (rows: NormalizedPlace[]) => NormalizedPlace[];
    /** A pre-terrain artifact, as published before osm-places-v2. */
    legacy?: boolean;
  } = {},
): ValidatedCatalogue {
  const normalizationVersion = options.legacy
    ? 'osm-places-v1'
    : NORMALIZATION_VERSION;
  const coverage = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [7, 45],
          [10, 45],
          [10, 48],
          [7, 48],
          [7, 45],
        ],
      ],
    ],
  };
  const identity: CatalogueIdentity = {
    ...(options.regionId ? { region_id: options.regionId } : {}),
    format_version: CATALOGUE_FORMAT_VERSION,
    normalization_version: normalizationVersion,
    source: {
      provider: 'Geofabrik',
      url: 'https://example.invalid/synthetic.osm.pbf',
      data_as_of: options.dataAsOf ?? '2026-10-20T20:23:47Z',
      pbf_sha256: options.sourceSha256 ?? 'a'.repeat(64),
      pbf_bytes: 1,
      selected_objects_sha256: 'b'.repeat(64),
      hut_points_sha256: 'c'.repeat(64),
      geometry_audit_sha256: 'd'.repeat(64),
      geometry_resolver_sha256: 'e'.repeat(64),
      selector_script_sha256: 'f'.repeat(64),
    },
    coverage: {
      file: 'coverage.geojson',
      sha256: sha256(`${canonicalJson(coverage)}\n`),
      poly_sha256: 'a'.repeat(64),
      source_url: 'https://example.invalid/synthetic.poly',
      note: COVERAGE_NOTE,
    },
    toolchain: { node: 'synthetic-fixed', icu: 'synthetic-fixed' },
    selectors: PLACE_SELECTORS,
    attribution: CATALOGUE_ATTRIBUTION,
    ...(options.legacy ? {} : { terrain: currentTerrainIdentity() }),
  };
  const common = {
    osm_version: 1,
    osm_updated_at: '2026-10-20T20:23:47Z',
    normalization_version: normalizationVersion,
    catalogue_snapshot_id: catalogueSnapshotId(identity),
  };
  const initial: NormalizedPlace[] = [
    {
      ...common,
      osm_type: 'node',
      osm_id: '9007199254740993',
      kinds: ['peak'],
      subtypes: ['peak'],
      display_name: 'Synthetic summit',
      names: { name: 'Synthetic summit', 'name:de': 'Prüfgipfel' },
      location: { longitude: 8.123456789, latitude: 46.987654321 },
      elevation_m: 1234.56789,
      tags: { name: 'Synthetic summit', natural: 'peak', ele: '1234.56789' },
      point_derivation: 'osm_node',
    },
    {
      ...common,
      osm_type: 'node',
      osm_id: '9007199254740994',
      kinds: ['pass'],
      subtypes: ['natural_saddle', 'road_trail_pass'],
      display_name: 'Synthetic pass',
      names: { name: 'Synthetic pass' },
      location: { longitude: 8.2, latitude: 46.9 },
      tags: { name: 'Synthetic pass', natural: 'saddle', mountain_pass: 'yes' },
      point_derivation: 'osm_node',
    },
    {
      ...common,
      osm_type: 'way',
      osm_id: '9007199254740993',
      kinds: ['hut'],
      subtypes: ['alpine_hut'],
      display_name: 'Synthetic hut',
      names: { name: 'Synthetic hut' },
      location: { longitude: 8.3, latitude: 46.8 },
      tags: { name: 'Synthetic hut', tourism: 'alpine_hut', building: 'yes' },
      point_derivation: 'validated_polygon_interior',
    },
  ];
  const transformed = options.transformRows
    ? options.transformRows(initial)
    : initial;
  const rows = options.legacy ? transformed : applyPlaceFilter(transformed);
  const serialized = serializeCatalogueRows(rows);
  return validateCatalogue({
    manifest: {
      ...identity,
      catalogue_snapshot_id: common.catalogue_snapshot_id,
      counts: catalogueCounts(rows),
      artifact: {
        file: 'places.jsonl',
        sha256: sha256(serialized),
        bytes: Buffer.byteLength(serialized),
      },
    },
    rows,
    coverage,
  });
}
