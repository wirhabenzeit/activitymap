import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import {
  CATALOGUE_ATTRIBUTION,
  CATALOGUE_FORMAT_VERSION,
  COVERAGE_NOTE,
  type CatalogueIdentity,
  canonicalJson,
  catalogueCounts,
  catalogueSnapshotId,
  serializeCatalogueRows,
  sha256,
  validateCatalogue,
} from '../../src/server/places/catalogue-artifact';
import { parseCoveragePoly } from '../../src/server/places/coverage';
import {
  NORMALIZATION_VERSION,
  PLACE_SELECTORS,
  normalizeSourceObject,
} from '../../src/server/places/normalize-source';

// This command publishes only the audited frozen Swiss experiment. The source
// normalizer has no object-ID exceptions and can be reused for later snapshots.
const SWISS_PBF_SHA256 =
  '8e2d91fab19a65898fa6b8e56d51f4a14952110c7bfcb2a495fd02911931a0b0';
const SWISS_DATA_AS_OF = '2026-10-20T20:23:47Z';
const EXPECTED_COUNTS = {
  total: 11325,
  by_kind: { peak: 8011, pass: 2463, hut: 851 },
  by_subtype: {
    peak: 8011,
    natural_saddle: 2393,
    road_trail_pass: 826,
    alpine_hut: 632,
    wilderness_hut: 219,
  },
  by_osm_type: { node: 10802, way: 521, relation: 2 },
  derived_hut_points: 523,
  localized_only_names: 6,
};
const downloadSchema = z.object({
  source_url: z.url(),
  source_page_data_as_of: z.string(),
  bytes: z.number().int().positive(),
  sha256: z.string(),
  coverage_url: z.url(),
});
const summarySchema = z.object({
  schema_version: z.literal('osm-catalog-measurement-v1'),
  status: z.literal('complete'),
  source: z.object({
    sha256: z.string(),
    file_bytes: z.number(),
    data_as_of: z.string(),
  }),
  method: z.object({ selectors: z.unknown(), script_sha256: z.string() }),
  unique_selected_objects: z.literal(12931),
});
const geometrySummarySchema = z.object({
  schema_version: z.literal('osm-hut-geometry-audit-v1'),
  status: z.literal('complete'),
  source: z.object({
    pbf_sha256: z.string(),
    selected_jsonl_sha256: z.string(),
    data_as_of: z.string(),
  }),
  method: z.object({ script_sha256: z.string() }),
  outputs: z.object({
    points: z.object({ rows: z.literal(922), bytes: z.number() }),
    audit: z.object({ rows: z.literal(922), bytes: z.number() }),
  }),
});
const identitySchema = z.object({
  osm_type: z.enum(['node', 'way', 'relation']),
  osm_id: z.string().regex(/^[1-9][0-9]*$/),
});
const auditSchema = identitySchema.extend({
  status: z.literal('valid'),
  point: z.object({ lat: z.number(), lon: z.number() }),
  point_derivation: z.string(),
  geometry_type: z.string(),
});

async function fileHash(path: string) {
  const digest = createHash('sha256');
  for await (const block of createReadStream(path))
    digest.update(block as Buffer);
  return digest.digest('hex');
}
function jsonLines(text: string): unknown[] {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown);
}
function keyedRecords(records: unknown[]) {
  const result = new Map<string, unknown>();
  for (const value of records) {
    const { osm_type, osm_id } = identitySchema.parse(value);
    const key = `${osm_type}/${osm_id}`;
    if (result.has(key))
      throw new Error(`Duplicate input source identity: ${key}`);
    result.set(key, value);
  }
  return result;
}

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Export the frozen Swiss snapshot without network or database access:\n  pnpm places:export --source output/osm-catalog/switzerland-2026-10-20 --out output/places/switzerland-2026-10-20',
  );
} else {
  if (!values.source || !values.out)
    throw new Error(
      'Required: --source <audited snapshot directory> --out <new artifact directory>',
    );
  const sourceDir = resolve(values.source);
  const outputDir = resolve(values.out);
  const [
    downloadText,
    summaryText,
    geometrySummaryText,
    selectedText,
    pointsText,
    auditText,
    polyText,
  ] = await Promise.all(
    [
      'download-manifest.json',
      'analysis/summary.json',
      'geometry/hut-geometry-summary.json',
      'analysis/selected-source-objects.jsonl',
      'geometry/hut-points.jsonl',
      'geometry/hut-geometry-audit.jsonl',
      'switzerland.poly',
    ].map((file) => readFile(join(sourceDir, file), 'utf8')),
  );
  const download = downloadSchema.parse(JSON.parse(downloadText!));
  const summary = summarySchema.parse(JSON.parse(summaryText!));
  const geometrySummary = geometrySummarySchema.parse(
    JSON.parse(geometrySummaryText!),
  );
  const pbfPath = join(sourceDir, 'switzerland-261020.osm.pbf');
  for (const value of [
    download.sha256,
    summary.source.sha256,
    geometrySummary.source.pbf_sha256,
    await fileHash(pbfPath),
  ]) {
    assert.equal(
      value,
      SWISS_PBF_SHA256,
      'Inputs must identify the audited frozen Swiss PBF',
    );
  }
  assert.equal(download.bytes, (await stat(pbfPath)).size);
  assert.equal(summary.source.file_bytes, download.bytes);
  for (const value of [
    download.source_page_data_as_of,
    summary.source.data_as_of,
    geometrySummary.source.data_as_of,
  ]) {
    assert.equal(
      value,
      SWISS_DATA_AS_OF,
      'Input snapshot timestamps must agree',
    );
  }
  assert.equal(
    canonicalJson(summary.method.selectors),
    canonicalJson(PLACE_SELECTORS),
  );
  assert.equal(
    sha256(selectedText!),
    geometrySummary.source.selected_jsonl_sha256,
    'Geometry must refer to these selected sources',
  );
  assert.equal(
    Buffer.byteLength(pointsText!),
    geometrySummary.outputs.points.bytes,
  );
  assert.equal(
    Buffer.byteLength(auditText!),
    geometrySummary.outputs.audit.bytes,
  );
  assert.equal(
    await fileHash(
      resolve('scripts/prototypes/osm-catalog/resolve_hut_points.py'),
    ),
    geometrySummary.method.script_sha256,
    'Geometry resolver differs from the audited version',
  );
  assert.equal(
    await fileHash(
      resolve('scripts/prototypes/osm-catalog/measure_snapshot.py'),
    ),
    summary.method.script_sha256,
    'Selector differs from the audited version',
  );

  const selected = keyedRecords(jsonLines(selectedText!));
  const points = keyedRecords(jsonLines(pointsText!));
  const audits = keyedRecords(jsonLines(auditText!));
  assert.equal(selected.size, summary.unique_selected_objects);
  assert.equal(points.size, geometrySummary.outputs.points.rows);
  assert.equal(audits.size, geometrySummary.outputs.audit.rows);
  for (const [key, value] of points) {
    assert(selected.has(key), `Hut point without selected source: ${key}`);
    const point = auditSchema.parse(value);
    const audit = auditSchema.parse(audits.get(key));
    assert.deepEqual(
      point,
      audit,
      `Hut point and geometry audit disagree: ${key}`,
    );
  }

  const coverage = parseCoveragePoly(polyText!);
  const coverageText = `${canonicalJson(coverage)}\n`;
  const identity: CatalogueIdentity = {
    format_version: CATALOGUE_FORMAT_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    source: {
      provider: 'Geofabrik',
      url: download.source_url,
      data_as_of: SWISS_DATA_AS_OF,
      pbf_sha256: SWISS_PBF_SHA256,
      pbf_bytes: download.bytes,
      selected_objects_sha256: sha256(selectedText!),
      hut_points_sha256: sha256(pointsText!),
      geometry_audit_sha256: sha256(auditText!),
      geometry_resolver_sha256: geometrySummary.method.script_sha256,
      selector_script_sha256: summary.method.script_sha256,
    },
    coverage: {
      file: 'coverage.geojson',
      sha256: sha256(coverageText),
      poly_sha256: sha256(polyText!),
      source_url: download.coverage_url,
      note: COVERAGE_NOTE,
    },
    toolchain: {
      node: process.versions.node,
      icu: process.versions.icu ?? 'unknown',
    },
    selectors: PLACE_SELECTORS,
    attribution: CATALOGUE_ATTRIBUTION,
  };
  const snapshotId = catalogueSnapshotId(identity);
  const rows = [...selected]
    .flatMap(([key, value]) => {
      const row = normalizeSourceObject(value, points.get(key), {
        catalogueSnapshotId: snapshotId,
        normalizationVersion: NORMALIZATION_VERSION,
      });
      return row ? [row] : [];
    })
    .sort((a, b) => {
      const order = { node: 0, way: 1, relation: 2 };
      return (
        order[a.osm_type] - order[b.osm_type] ||
        (BigInt(a.osm_id) < BigInt(b.osm_id)
          ? -1
          : BigInt(a.osm_id) > BigInt(b.osm_id)
            ? 1
            : 0)
      );
    });
  const counts = catalogueCounts(rows);
  assert.deepEqual(
    counts,
    EXPECTED_COUNTS,
    'Normalized Swiss counts differ from the reviewed experiment',
  );
  const contents = serializeCatalogueRows(rows);
  const manifest = {
    ...identity,
    catalogue_snapshot_id: snapshotId,
    counts,
    artifact: {
      file: 'places.jsonl' as const,
      sha256: sha256(contents),
      bytes: Buffer.byteLength(contents),
    },
  };
  validateCatalogue({ manifest, rows, coverage });

  // Refuse existing output. Publish the manifest last as the completion marker.
  await mkdir(dirname(outputDir), { recursive: true });
  await mkdir(outputDir);
  try {
    await writeFile(join(outputDir, 'places.jsonl'), contents, { flag: 'wx' });
    await writeFile(join(outputDir, 'coverage.geojson'), coverageText, {
      flag: 'wx',
    });
    await writeFile(
      join(outputDir, 'manifest.json'),
      `${canonicalJson(manifest)}\n`,
      { flag: 'wx' },
    );
  } catch (error) {
    await rm(outputDir, { recursive: true, force: true });
    throw error;
  }
  console.log(
    JSON.stringify(
      {
        directory: outputDir,
        snapshot_id: snapshotId,
        counts,
        artifact: manifest.artifact,
      },
      null,
      2,
    ),
  );
}
