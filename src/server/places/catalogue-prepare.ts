import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

import { z } from 'zod';

import {
  CATALOGUE_ATTRIBUTION,
  CATALOGUE_FORMAT_VERSION,
  COVERAGE_NOTE,
  type CatalogueIdentity,
  canonicalJson,
  catalogueCounts,
  catalogueRegionSchema,
  catalogueSnapshotId,
  currentTerrainIdentity,
  serializeCatalogueRows,
  sha256,
  validateCatalogue,
} from './catalogue-artifact';
import { parseCoveragePoly } from './coverage';
import { hutRelationWays, resolveHutPoint } from './hut-geometry';
import {
  NORMALIZATION_VERSION,
  PLACE_SELECTORS,
  normalizeSourceObject,
  sourceDisplayName,
} from './normalize-source';
import { type OsmSource, scanPbf } from './osm-pbf';
import { applyPlaceFilter } from './place-filter';
import { type DemSource, measureTerrain } from './terrain';

export async function fileSha256(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}
export const NODE_PREPARATION_VERSION = 'osm-places-node-v1';
function selected(tags: Record<string, string>) {
  return (
    tags.natural === 'peak' ||
    tags.natural === 'saddle' ||
    tags.mountain_pass === 'yes' ||
    tags.tourism === 'alpine_hut' ||
    tags.tourism === 'wilderness_hut'
  );
}
const isHut = (source: OsmSource) =>
  source.tags.tourism === 'alpine_hut' ||
  source.tags.tourism === 'wilderness_hut';
const sourceKey = (source: OsmSource) => `${source.osm_type}/${source.osm_id}`;
const order = (a: OsmSource, b: OsmSource) => {
  const rank = { node: 0, way: 1, relation: 2 };
  return (
    rank[a.osm_type] - rank[b.osm_type] ||
    (BigInt(a.osm_id) < BigInt(b.osm_id)
      ? -1
      : BigInt(a.osm_id) > BigInt(b.osm_id)
        ? 1
        : 0)
  );
};
async function implementationHash(files: string[]) {
  const sources = await Promise.all(
    files.map((name) => readFile(new URL(name, import.meta.url), 'utf8')),
  );
  return sha256(
    canonicalJson({ version: NODE_PREPARATION_VERSION, files, sources }),
  );
}

/** Entire preparation runs in Node. Only selected sources and hut dependencies
 * are retained across streaming passes; no global node-location index is built.
 * Preparation has no database access and requires a complete current snapshot. */
export async function prepareCatalogue(input: {
  regionId: string;
  pbfPath: string;
  polyPath: string;
  sourceUrl: string;
  coverageUrl: string;
  /** Terrain for pass and peak metrics: Copernicus GLO-30 in production. */
  dem: DemSource;
  onProgress?: (message: string) => void;
}) {
  const regionId = catalogueRegionSchema.parse(input.regionId);
  const [selectorHash, geometryHash] = await Promise.all([
    implementationHash([
      './osm-pbf.ts',
      './catalogue-prepare.ts',
      './normalize-source.ts',
      './terrain.ts',
      './copernicus-dem.ts',
      './place-filter.ts',
    ]),
    implementationHash(['./hut-geometry.ts', './coverage.ts']),
  ]);
  const before = await stat(input.pbfPath, { bigint: true });
  const pbfHash = await fileSha256(input.pbfPath);
  const coverageText = await readFile(input.polyPath, 'utf8');
  const coverage = parseCoveragePoly(coverageText);
  const sources = new Map<string, OsmSource>();
  let selectedBytes = 0;
  input.onProgress?.('Selecting place sources from the PBF snapshot');
  const header = await scanPbf(input.pbfPath, {
    select: selected,
    onSource(source) {
      const key = sourceKey(source);
      if (sources.has(key))
        throw new Error(`Duplicate selected source identity: ${key}`);
      if (sources.size >= 100_000)
        throw new Error('Catalogue exceeds the 100000 selected source limit');
      selectedBytes += Buffer.byteLength(canonicalJson(source));
      if (selectedBytes > 67_108_864)
        throw new Error('Selected sources exceed the 64 MiB preparation limit');
      sources.set(key, source);
    },
  });
  const ordered = [...sources.values()].sort(order);
  const exclusions: NonNullable<CatalogueIdentity['source']['exclusions']> = [];
  for (const source of ordered) {
    const name = sourceDisplayName(source.tags);
    if (source.osm_type === 'node' || name === undefined) continue;
    let reason:
      | NonNullable<CatalogueIdentity['source']['exclusions']>[number]['reason']
      | undefined;
    if (!isHut(source)) reason = 'unsupported_peak_or_pass_area';
    else if (
      source.osm_type === 'relation' &&
      source.tags.type !== 'multipolygon'
    )
      reason = 'unsupported_hut_relation_type';
    else if (
      source.osm_type === 'relation' &&
      source.members?.some(
        (member) =>
          member.type !== 'way' || !['outer', 'inner'].includes(member.role),
      )
    )
      reason = 'unsupported_hut_relation_members';
    else if (
      source.osm_type === 'way' &&
      (source.tags.area === 'no' ||
        !source.node_refs?.length ||
        source.node_refs[0] !== source.node_refs.at(-1))
    )
      reason = 'unsupported_hut_way_line';
    if (reason)
      exclusions.push({
        osm_type: source.osm_type,
        osm_id: source.osm_id,
        name,
        reason,
      });
  }
  if (exclusions.length)
    input.onProgress?.(
      `Reporting ${exclusions.length} unsupported source representations`,
    );
  const excludedKeys = new Set(
    exclusions.map((source) => `${source.osm_type}/${source.osm_id}`),
  );
  const huts = ordered.filter(
    (source) =>
      isHut(source) &&
      sourceDisplayName(source.tags) !== undefined &&
      !excludedKeys.has(sourceKey(source)),
  );
  const ways = new Map<string, string[]>();
  let requiredWays = new Set<string>();
  for (const hut of huts) {
    if (hut.osm_type === 'way') ways.set(hut.osm_id, hut.node_refs ?? []);
    else if (hut.osm_type === 'relation') {
      const members = hutRelationWays(hut);
      for (const ref of [...members.outer, ...members.inner])
        requiredWays.add(ref);
    }
  }
  requiredWays = new Set([...requiredWays].filter((id) => !ways.has(id)));
  if (requiredWays.size) {
    input.onProgress?.(`Resolving ${requiredWays.size} hut member ways`);
    const pass = await scanPbf(input.pbfPath, {
      wayIds: requiredWays,
      onSource(source) {
        if (ways.has(source.osm_id))
          throw new Error(`Duplicate hut member way: ${source.osm_id}`);
        ways.set(source.osm_id, source.node_refs ?? []);
      },
    });
    if (pass.dataAsOf !== header.dataAsOf)
      throw new Error('PBF changed between source and dependency passes');
    for (const id of requiredWays)
      if (!ways.has(id)) throw new Error(`Missing hut member way: ${id}`);
  }
  const requiredNodes = new Set<string>();
  for (const refs of ways.values()) {
    if (refs.length > 10_000)
      throw new Error('Hut way exceeds the supported vertex limit');
    for (const ref of refs) {
      requiredNodes.add(ref);
      if (requiredNodes.size > 1_000_000)
        throw new Error('Hut dependencies exceed the supported node limit');
    }
  }
  const locations = new Map<string, [number, number]>();
  if (requiredNodes.size) {
    input.onProgress?.(`Resolving ${requiredNodes.size} hut node positions`);
    const pass = await scanPbf(input.pbfPath, {
      nodeIds: requiredNodes,
      onSource(source) {
        if (locations.has(source.osm_id))
          throw new Error(`Duplicate hut node: ${source.osm_id}`);
        if (!source.point)
          throw new Error(`Missing hut node position: ${source.osm_id}`);
        locations.set(source.osm_id, [source.point.lon, source.point.lat]);
      },
    });
    if (pass.dataAsOf !== header.dataAsOf)
      throw new Error('PBF changed between source and dependency passes');
    for (const id of requiredNodes)
      if (!locations.has(id))
        throw new Error(`Missing hut node position: ${id}`);
  }
  const points = new Map(
    huts.map((source) => {
      try {
        return [
          sourceKey(source),
          resolveHutPoint(source, ways, locations),
        ] as const;
      } catch (error) {
        throw new Error(
          `Cannot resolve hut ${sourceKey(source)} (${source.tags.name ?? 'localized name'})`,
          { cause: error },
        );
      }
    }),
  );
  const after = await stat(input.pbfPath, { bigint: true });
  if (
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    pbfHash !== (await fileSha256(input.pbfPath))
  )
    throw new Error('PBF snapshot changed during preparation');
  const afterImplementation = await Promise.all([
    implementationHash([
      './osm-pbf.ts',
      './catalogue-prepare.ts',
      './normalize-source.ts',
      './terrain.ts',
      './copernicus-dem.ts',
      './place-filter.ts',
    ]),
    implementationHash(['./hut-geometry.ts', './coverage.ts']),
  ]);
  if (
    selectorHash !== afterImplementation[0] ||
    geometryHash !== afterImplementation[1]
  )
    throw new Error(
      'Preparation implementation changed while processing the snapshot',
    );
  const pointsText = `${[...points.values()].map(canonicalJson).join('\n')}\n`;
  const identity: CatalogueIdentity = {
    region_id: regionId,
    format_version: CATALOGUE_FORMAT_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    source: {
      provider: 'Geofabrik',
      url: z.url().parse(input.sourceUrl),
      data_as_of: header.dataAsOf,
      pbf_sha256: pbfHash,
      pbf_bytes: Number(before.size),
      selected_objects_sha256: sha256(
        `${ordered.map(canonicalJson).join('\n')}\n`,
      ),
      hut_points_sha256: sha256(pointsText),
      geometry_audit_sha256: sha256(
        canonicalJson({
          version: NODE_PREPARATION_VERSION,
          points: [...points.values()],
        }),
      ),
      geometry_resolver_sha256: geometryHash,
      selector_script_sha256: selectorHash,
      ...(exclusions.length ? { exclusions } : {}),
    },
    coverage: {
      file: 'coverage.geojson',
      sha256: sha256(`${canonicalJson(coverage)}\n`),
      poly_sha256: sha256(coverageText),
      source_url: z.url().parse(input.coverageUrl),
      note: COVERAGE_NOTE,
    },
    toolchain: {
      node: process.versions.node,
      icu: process.versions.icu ?? 'unknown',
    },
    selectors: PLACE_SELECTORS,
    attribution: CATALOGUE_ATTRIBUTION,
    terrain: currentTerrainIdentity(),
  };
  const snapshotId = catalogueSnapshotId(identity);
  const normalized = ordered.flatMap((source) => {
    if (excludedKeys.has(sourceKey(source))) return [];
    const place = normalizeSourceObject(source, points.get(sourceKey(source)), {
      catalogueSnapshotId: snapshotId,
      normalizationVersion: NORMALIZATION_VERSION,
    });
    return place ? [place] : [];
  });
  input.onProgress?.('Measuring pass and peak terrain');
  const rows = applyPlaceFilter(
    await measureTerrain(normalized, input.dem, {
      onProgress: input.onProgress,
    }),
  );
  const serialized = serializeCatalogueRows(rows);
  return validateCatalogue({
    manifest: {
      ...identity,
      catalogue_snapshot_id: snapshotId,
      counts: catalogueCounts(rows),
      artifact: {
        file: 'places.jsonl',
        bytes: Buffer.byteLength(serialized),
        sha256: sha256(serialized),
      },
    },
    rows,
    coverage,
  });
}
