import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'node:test';

import {
  canonicalJson,
  loadCatalogueArtifact,
  serializeCatalogueDuplicates,
  serializeCatalogueRows,
  validateCatalogue,
} from './catalogue-artifact';
import {
  catalogueCoverageContains,
  combineCatalogues,
  unionCatalogueCoverage,
} from './catalogue-combine';
import { createSyntheticCatalogue } from './catalogue.fixture';
import { parseCoverageGeometry } from './coverage';

const rectangle = (west: number, east: number) =>
  parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [west, 45],
          [east, 45],
          [east, 48],
          [west, 48],
          [west, 45],
        ],
      ],
    ],
  });
void test('coverage union removes internal country seams and preserves holes/disconnected islands', () => {
  const west = rectangle(7, 9),
    east = rectangle(8, 10),
    united = unionCatalogueCoverage([west, east]);
  assert.equal(united.coordinates.length, 1);
  assert(catalogueCoverageContains(united, west));
  assert(catalogueCoverageContains(united, east));
  assert(catalogueCoverageContains(united, rectangle(8.9, 9.1)));
  assert(!catalogueCoverageContains(united, rectangle(9.9, 10.1)));
  const hole = parseCoverageGeometry({
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
        [
          [8, 46],
          [8, 47],
          [9, 47],
          [9, 46],
          [8, 46],
        ],
      ],
    ],
  });
  const island = rectangle(11, 12);
  const withIsland = unionCatalogueCoverage([hole, island]);
  assert.equal(withIsland.coordinates.length, 2);
  assert.equal(withIsland.coordinates[0]!.length, 2);
  assert(!catalogueCoverageContains(withIsland, rectangle(8.1, 8.9)));
});
void test('country overlap deduplicates source IDs and records full input provenance', async () => {
  const swiss = createSyntheticCatalogue({ regionId: 'switzerland' });
  const austria = createSyntheticCatalogue({
    regionId: 'austria',
    transformRows: (rows) => [...rows, { ...rows[0]!, osm_id: '12345' }],
  });
  const italy = createSyntheticCatalogue({ regionId: 'italy' });
  const result = combineCatalogues('ch-at-it', [swiss, austria, italy]);
  assert.equal(result.rows.length, 4);
  assert.equal(result.duplicates!.length, 3);
  assert.equal(result.manifest.deduplication!.duplicate_occurrences, 6);
  assert.deepEqual(result.duplicates![0]!.regions, [
    'austria',
    'italy',
    'switzerland',
  ]);
  assert(
    result.rows.some(
      (row) => row.osm_type === 'node' && row.osm_id === '9007199254740993',
    ),
  );
  assert(
    result.rows.some(
      (row) => row.osm_type === 'way' && row.osm_id === '9007199254740993',
    ),
  );
  assert.deepEqual(
    combineCatalogues('ch-at-it', [italy, swiss, austria]),
    result,
  );
  assert.equal(result.manifest.components!.length, 3);
  const corrupt = structuredClone(result);
  corrupt.duplicates![0]!.regions.pop();
  assert.throws(() => validateCatalogue(corrupt), /Duplicate report/);
  const missing = structuredClone(result);
  delete missing.duplicates;
  assert.throws(() => validateCatalogue(missing), /duplicate report/);
  const directory = await mkdtemp(join(tmpdir(), 'combined-catalogue-'));
  try {
    await writeFile(
      join(directory, 'manifest.json'),
      canonicalJson(result.manifest),
    );
    await writeFile(
      join(directory, 'places.jsonl'),
      serializeCatalogueRows(result.rows),
    );
    await writeFile(
      join(directory, 'coverage.geojson'),
      `${canonicalJson(result.coverage)}\n`,
    );
    await writeFile(
      join(directory, 'duplicates.jsonl'),
      serializeCatalogueDuplicates(result.duplicates!),
    );
    assert.deepEqual(await loadCatalogueArtifact(directory), result);
    await writeFile(join(directory, 'duplicates.jsonl'), '');
    await assert.rejects(loadCatalogueArtifact(directory), /Duplicate report/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
void test('different snapshot epochs, versions and same-version contents are rejected', () => {
  const swiss = createSyntheticCatalogue({ regionId: 'switzerland' });
  for (const other of [
    createSyntheticCatalogue({
      regionId: 'austria',
      dataAsOf: '2026-10-21T00:00:00Z',
    }),
    createSyntheticCatalogue({
      regionId: 'austria',
      transformRows: (rows) => rows.map((row) => ({ ...row, osm_version: 2 })),
    }),
    createSyntheticCatalogue({
      regionId: 'austria',
      transformRows: (rows) =>
        rows.map((row) => ({ ...row, display_name: 'Conflicting name' })),
    }),
  ])
    assert.throws(() => combineCatalogues('ch-at-it', [swiss, other]));
  assert.throws(
    () => combineCatalogues('ch-at-it', [swiss, swiss]),
    /distinct/,
  );
  assert.throws(
    () => combineCatalogues('ch-at-it', [swiss, createSyntheticCatalogue()]),
    /named/,
  );
});
