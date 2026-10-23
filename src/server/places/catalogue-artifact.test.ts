import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'node:test';

import {
  canonicalJson,
  catalogueSnapshotId,
  loadCatalogueArtifact,
  serializeCatalogueRows,
  sha256,
  validateCatalogue,
} from './catalogue-artifact';
import { createSyntheticCatalogue } from './catalogue.fixture';

void test('canonical artifact retains exact source IDs, raw tags and original strings', () => {
  const catalogue = createSyntheticCatalogue({
    transformRows: (rows) => {
      rows[0]!.tags = JSON.parse(
        '{"name":"Synthetic summit","natural":"peak","__proto__":"raw OSM value","constructor":"also data","ele":"1234.56789"}',
      ) as Record<string, string>;
      return rows;
    },
  });
  const parsed = validateCatalogue(catalogue);
  assert.equal(parsed.rows[0]!.osm_id, '9007199254740993');
  assert.equal(Object.hasOwn(parsed.rows[0]!.tags, '__proto__'), true);
  assert.equal(parsed.rows[0]!.tags.__proto__, 'raw OSM value');
  assert.notEqual(
    parsed.rows[0]!.tags,
    catalogue.rows[0]!.tags,
    'validation clones caller data',
  );
  assert.equal(canonicalJson({ z: 1, a: 'ä' }), '{"a":"ä","z":1}');
  assert.throws(() => canonicalJson({ n: Infinity }), /Nonfinite/);
});

void test('snapshot identity binds source, coverage, normalization and toolchain', () => {
  const catalogue = createSyntheticCatalogue();
  assert.equal(
    catalogueSnapshotId(catalogue.manifest),
    catalogue.manifest.catalogue_snapshot_id,
  );
  for (const change of [
    { source: { ...catalogue.manifest.source, pbf_sha256: '1'.repeat(64) } },
    {
      coverage: { ...catalogue.manifest.coverage, poly_sha256: '2'.repeat(64) },
    },
    { toolchain: { ...catalogue.manifest.toolchain, icu: 'another-version' } },
  ]) {
    assert.throws(
      () =>
        validateCatalogue({
          ...catalogue,
          manifest: { ...catalogue.manifest, ...change },
        }),
      /snapshot identity/,
    );
  }
});

void test('rejects manifest counts, changed rows and mixed snapshot identities', () => {
  const catalogue = createSyntheticCatalogue();
  assert.throws(
    () =>
      validateCatalogue({
        ...catalogue,
        manifest: {
          ...catalogue.manifest,
          counts: { ...catalogue.manifest.counts, total: 4 },
        },
      }),
    /counts/,
  );
  for (const mutation of [
    (row: (typeof catalogue.rows)[number]) => {
      row.display_name = 'Tampered';
    },
    (row: (typeof catalogue.rows)[number]) => {
      row.location.latitude = 91;
    },
    (row: (typeof catalogue.rows)[number]) => {
      row.catalogue_snapshot_id = `osm-places-v1:${'f'.repeat(64)}`;
    },
    (row: (typeof catalogue.rows)[number]) => {
      row.osm_updated_at = '2026-10-21T00:00:00Z';
    },
    (row: (typeof catalogue.rows)[number]) => {
      row.elevation_m = 1e300;
    },
  ]) {
    const changed = structuredClone(catalogue);
    mutation(changed.rows[0]!);
    assert.throws(() => validateCatalogue(changed));
  }
});

void test('duplicate identities cannot be concealed by updating counts and hashes', () => {
  assert.throws(
    () =>
      createSyntheticCatalogue({
        transformRows: (rows) => [...rows, rows[0]!],
      }),
    /Duplicate source identity/,
  );
});

void test('a self-consistent artifact cannot silently underflow elevation to zero', () => {
  assert.throws(
    () =>
      createSyntheticCatalogue({
        transformRows: (rows) => {
          rows[0]!.elevation_m = 1e-300;
          return rows;
        },
      }),
    /underflow/,
  );
});

void test('coverage edits and unsupported file paths are refused', () => {
  const catalogue = createSyntheticCatalogue();
  const altered = structuredClone(catalogue);
  altered.coverage.coordinates[0]![0]![1]![0] = 10.5;
  assert.throws(() => validateCatalogue(altered), /Coverage hash/);
  for (const field of ['artifact', 'coverage'] as const) {
    assert.throws(() =>
      validateCatalogue({
        ...catalogue,
        manifest: {
          ...catalogue.manifest,
          [field]: { ...catalogue.manifest[field], file: '../../outside.json' },
        },
      }),
    );
  }
});

void test('filesystem loader validates canonical contents and never accepts partial publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'place-catalogue-artifact-'));
  const catalogue = createSyntheticCatalogue();
  const contents = serializeCatalogueRows(catalogue.rows);
  try {
    await writeFile(join(directory, 'places.jsonl'), contents);
    await assert.rejects(loadCatalogueArtifact(directory), /ENOENT/);
    await writeFile(
      join(directory, 'coverage.geojson'),
      `${canonicalJson(catalogue.coverage)}\n`,
    );
    await writeFile(
      join(directory, 'manifest.json'),
      canonicalJson(catalogue.manifest),
    );
    assert.deepEqual(await loadCatalogueArtifact(directory), catalogue);
    await writeFile(join(directory, 'places.jsonl'), `${contents} `);
    await assert.rejects(
      loadCatalogueArtifact(directory),
      /hash\/size mismatch/,
    );
    // Even a matching file hash cannot hide duplicate JSON keys, extra blank
    // rows or an alternative serialization: normalized canonical bytes bind it.
    const differentBytes = `${contents.replace('"osm_type":"node"', '"osm_type":"way","osm_type":"node"')}`;
    await writeFile(join(directory, 'places.jsonl'), differentBytes);
    await writeFile(
      join(directory, 'manifest.json'),
      canonicalJson({
        ...catalogue.manifest,
        artifact: {
          ...catalogue.manifest.artifact,
          bytes: Buffer.byteLength(differentBytes),
          sha256: sha256(differentBytes),
        },
      }),
    );
    await assert.rejects(
      loadCatalogueArtifact(directory),
      /artifact hash\/size/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
