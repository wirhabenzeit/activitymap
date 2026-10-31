import polygonClipping, { type MultiPolygon } from 'polygon-clipping';

import {
  type CatalogueDuplicate,
  type CatalogueIdentity,
  type ValidatedCatalogue,
  canonicalJson,
  catalogueCounts,
  catalogueRegionSchema,
  catalogueSnapshotId,
  serializeCatalogueDuplicates,
  serializeCatalogueRows,
  sha256,
  validateCatalogue,
} from './catalogue-artifact';
import { type CoverageGeometry, parseCoverageGeometry } from './coverage';
import { applyPlaceFilter } from './place-filter';
import type { NormalizedPlace } from './types';

function polygon(coverage: CoverageGeometry): MultiPolygon {
  return coverage.coordinates.map((part) =>
    part.map((ring) =>
      ring.map((point) => [point[0]!, point[1]!] as [number, number]),
    ),
  );
}
export function unionCatalogueCoverage(
  coverages: CoverageGeometry[],
): CoverageGeometry {
  if (!coverages.length)
    throw new Error('Coverage union needs at least one input');
  const inputs = coverages.map((coverage) =>
    polygon(parseCoverageGeometry(coverage)),
  );
  return parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: polygonClipping.union(inputs[0]!, ...inputs.slice(1)),
  });
}
export function catalogueCoverageContains(
  outer: CoverageGeometry,
  inner: CoverageGeometry,
): boolean {
  return (
    polygonClipping.difference(
      polygon(parseCoverageGeometry(inner)),
      polygon(parseCoverageGeometry(outer)),
    ).length === 0
  );
}
const key = (row: NormalizedPlace) => `${row.osm_type}/${row.osm_id}`;
/** Hidden decisions can depend on same-name passes across a border, so they
 * are recomputed for the combined rows rather than compared. */
function sourceContent(row: NormalizedPlace) {
  const content = { ...row, catalogue_snapshot_id: 'comparison' };
  delete content.hidden_reason;
  return canonicalJson(content);
}

/** A single serving catalogue from aligned, independently validated country
 * artifacts. Dedupe exact source identities; never conflate nearby names or
 * silently resolve conflicting versions from different extract timestamps. */
export function combineCatalogues(
  regionId: string,
  inputs: ValidatedCatalogue[],
): ValidatedCatalogue {
  catalogueRegionSchema.parse(regionId);
  const catalogues = inputs.map(validateCatalogue);
  if (
    catalogues.length < 2 ||
    catalogues.length > 16 ||
    catalogues.some(
      (catalogue) =>
        !catalogue.manifest.region_id || catalogue.manifest.components,
    )
  )
    throw new Error('Combine 2–16 named single-region catalogues');
  catalogues.sort((a, b) =>
    a.manifest.region_id!.localeCompare(b.manifest.region_id!, 'en'),
  );
  const regions = catalogues.map((catalogue) => catalogue.manifest.region_id!);
  if (new Set(regions).size !== regions.length || regions.includes(regionId))
    throw new Error('Combined/input region IDs must be distinct');
  const first = catalogues[0]!;
  if (
    catalogues.some(
      (catalogue) =>
        catalogue.manifest.source.data_as_of !==
          first.manifest.source.data_as_of ||
        canonicalJson(catalogue.manifest.toolchain) !==
          canonicalJson(first.manifest.toolchain) ||
        catalogue.manifest.normalization_version !==
          first.manifest.normalization_version ||
        canonicalJson(catalogue.manifest.terrain ?? null) !==
          canonicalJson(first.manifest.terrain ?? null),
    )
  )
    throw new Error(
      'Combine requires aligned timestamps and matching normalization/terrain/toolchains',
    );
  const sources = new Map<
    string,
    { row: NormalizedPlace; regions: string[] }
  >();
  for (const catalogue of catalogues)
    for (const row of catalogue.rows) {
      const existing = sources.get(key(row));
      if (existing) {
        if (sourceContent(existing.row) !== sourceContent(row))
          throw new Error(
            `Conflicting border source ${key(row)} in ${[...existing.regions, catalogue.manifest.region_id!].join(', ')}`,
          );
        existing.regions.push(catalogue.manifest.region_id!);
      } else
        sources.set(key(row), {
          row,
          regions: [catalogue.manifest.region_id!],
        });
    }
  const entries = [...sources.values()].sort(
    (a, b) =>
      a.row.osm_type.localeCompare(b.row.osm_type, 'en') ||
      (BigInt(a.row.osm_id) < BigInt(b.row.osm_id) ? -1 : 1),
  );
  const duplicates: CatalogueDuplicate[] = entries
    .filter((entry) => entry.regions.length > 1)
    .map(({ row, regions }) => ({
      osm_type: row.osm_type,
      osm_id: row.osm_id,
      osm_version: row.osm_version,
      name: row.display_name,
      regions,
    }));
  const report = serializeCatalogueDuplicates(duplicates);
  const coverage = unionCatalogueCoverage(
    catalogues.map((catalogue) => catalogue.coverage),
  );
  const components = catalogues.map(({ manifest }) => ({
    region_id: manifest.region_id!,
    snapshot_id: manifest.catalogue_snapshot_id,
    source: {
      url: manifest.source.url,
      data_as_of: manifest.source.data_as_of,
      pbf_sha256: manifest.source.pbf_sha256,
      pbf_bytes: manifest.source.pbf_bytes,
      selector_script_sha256: manifest.source.selector_script_sha256,
      geometry_resolver_sha256: manifest.source.geometry_resolver_sha256,
      ...(manifest.source.exclusions
        ? { exclusions: manifest.source.exclusions }
        : {}),
    },
    coverage_sha256: manifest.coverage.sha256,
    places_sha256: manifest.artifact.sha256,
    count: manifest.counts.total,
  }));
  const digest = (field: keyof typeof first.manifest.source) =>
    sha256(
      canonicalJson(
        catalogues.map(({ manifest }) => ({
          region: manifest.region_id,
          value: manifest.source[field],
        })),
      ),
    );
  const exclusions = [
    ...new Map(
      catalogues.flatMap(({ manifest }) =>
        (manifest.source.exclusions ?? []).map(
          (source) => [`${source.osm_type}/${source.osm_id}`, source] as const,
        ),
      ),
    ).values(),
  ];
  const identity: CatalogueIdentity = {
    region_id: regionId,
    format_version: first.manifest.format_version,
    normalization_version: first.manifest.normalization_version,
    components,
    deduplication: {
      policy: 'same-osm-identity-and-version-v1',
      duplicate_sources: duplicates.length,
      duplicate_occurrences: duplicates.reduce(
        (sum, duplicate) => sum + duplicate.regions.length - 1,
        0,
      ),
      file: 'duplicates.jsonl',
      sha256: sha256(report),
      bytes: Buffer.byteLength(report),
    },
    source: {
      ...first.manifest.source,
      url: 'https://download.geofabrik.de/europe.html',
      ...(exclusions.length ? { exclusions } : {}),
      pbf_sha256: digest('pbf_sha256'),
      selector_script_sha256: digest('selector_script_sha256'),
      geometry_resolver_sha256: digest('geometry_resolver_sha256'),
      pbf_bytes: components.reduce(
        (sum, component) => sum + component.source.pbf_bytes,
        0,
      ),
      selected_objects_sha256: digest('selected_objects_sha256'),
      hut_points_sha256: digest('hut_points_sha256'),
      geometry_audit_sha256: digest('geometry_audit_sha256'),
    },
    coverage: {
      ...first.manifest.coverage,
      sha256: sha256(`${canonicalJson(coverage)}\n`),
      poly_sha256: sha256(
        canonicalJson(
          catalogues.map(({ manifest }) => ({
            region: manifest.region_id,
            sha256: manifest.coverage.poly_sha256,
          })),
        ),
      ),
      source_url: 'https://download.geofabrik.de/europe.html',
    },
    toolchain: first.manifest.toolchain,
    selectors: first.manifest.selectors,
    attribution: first.manifest.attribution,
    ...(first.manifest.terrain ? { terrain: first.manifest.terrain } : {}),
  };
  const snapshotId = catalogueSnapshotId(identity);
  const combined = entries.map(({ row }) => ({
    ...row,
    catalogue_snapshot_id: snapshotId,
  }));
  const rows = first.manifest.terrain ? applyPlaceFilter(combined) : combined;
  const serialized = serializeCatalogueRows(rows);
  return validateCatalogue({
    manifest: {
      ...identity,
      catalogue_snapshot_id: snapshotId,
      counts: catalogueCounts(rows),
      artifact: {
        file: 'places.jsonl',
        sha256: sha256(serialized),
        bytes: Buffer.byteLength(serialized),
      },
    },
    rows,
    coverage,
    duplicates,
  });
}
