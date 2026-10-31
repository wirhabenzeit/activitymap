import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'node:test';

import { prepareCatalogue } from './catalogue-prepare';
import type { OsmSource } from './osm-pbf';
import { createPbfFixture } from './osm-pbf.fixture';
import { validatePublishedCatalogue } from './published-catalogue';
import { syntheticDem } from './terrain.fixture';

const sources: OsmSource[] = [
  {
    osm_type: 'node',
    osm_id: '9007199254740993',
    osm_version: 2,
    osm_timestamp: '2026-10-22T00:00:00Z',
    tags: { natural: 'peak', name: 'New summit' },
    point: { lon: 8.5, lat: 47 },
    point_derivation: 'osm_node',
  },
  ...[
    [8, 47],
    [8.1, 47],
    [8.1, 47.1],
    [8, 47.1],
  ].map(([lon, lat], index): OsmSource => ({
    osm_type: 'node',
    osm_id: String(index + 1),
    tags: {},
    point: { lon: lon!, lat: lat! },
    point_derivation: 'osm_node',
    osm_version: 1,
    osm_timestamp: '2026-10-20T00:00:00Z',
  })),
  {
    osm_type: 'way',
    osm_id: '10',
    osm_version: 2,
    osm_timestamp: '2026-10-22T00:00:00Z',
    tags: { tourism: 'alpine_hut', name: 'New hut' },
    node_refs: ['1', '2', '3', '4', '1'],
  },
  {
    osm_type: 'way',
    osm_id: '11',
    osm_version: 1,
    osm_timestamp: '2026-10-20T00:00:00Z',
    tags: {},
    node_refs: ['1', '2', '3'],
  },
  {
    osm_type: 'way',
    osm_id: '12',
    osm_version: 1,
    osm_timestamp: '2026-10-20T00:00:00Z',
    tags: {},
    node_refs: ['1', '4', '3'],
  },
  {
    osm_type: 'relation',
    osm_id: '20',
    osm_version: 2,
    osm_timestamp: '2026-10-22T00:00:00Z',
    tags: {
      tourism: 'wilderness_hut',
      type: 'multipolygon',
      name: 'Relation hut',
    },
    members: [
      { type: 'way', ref: '11', role: 'outer' },
      { type: 'way', ref: '12', role: 'outer' },
    ],
  },
];
void test('Node preparation streams fresh PBF snapshots, resolves selective dependencies and binds provenance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'node-place-prepare-'));
  try {
    const pbfPath = join(directory, 'source.pbf'),
      polyPath = join(directory, 'coverage.poly');
    await writeFile(pbfPath, createPbfFixture(sources, { dense: true }));
    await writeFile(
      polyPath,
      'synthetic\n1\n7 45\n10 45\n10 48\n7 48\n7 45\nEND\nEND\n',
    );
    const input = {
      regionId: 'synthetic',
      pbfPath,
      polyPath,
      sourceUrl: 'https://example.invalid/source.osm.pbf',
      coverageUrl: 'https://example.invalid/source.poly',
      dem: syntheticDem(),
    };
    const progress: string[] = [];
    const result = await prepareCatalogue({
      ...input,
      onProgress: (message) => progress.push(message),
    });
    assert.equal(result.rows.length, 3);
    assert.equal(result.manifest.region_id, 'synthetic');
    assert.equal(result.manifest.source.data_as_of, '2026-10-23T00:00:00Z');
    assert.equal(result.rows[0]!.osm_id, '9007199254740993');
    assert.equal(result.manifest.counts.derived_hut_points, 2);
    assert.deepEqual(result.rows[1]!.location, {
      longitude: 8.05,
      latitude: 47.05,
    });
    assert.deepEqual(result.rows[2]!.location, result.rows[1]!.location);
    assert(progress.some((message) => message.includes('member ways')));
    assert(progress.some((message) => message.includes('node positions')));
    assert.deepEqual(await prepareCatalogue(input), result);
    assert.notEqual(
      (await prepareCatalogue({ ...input, regionId: 'another' })).manifest
        .catalogue_snapshot_id,
      result.manifest.catalogue_snapshot_id,
    );
    assert.deepEqual(
      validatePublishedCatalogue(result).coverage,
      result.coverage,
    );
    await writeFile(
      pbfPath,
      createPbfFixture([
        ...sources,
        {
          ...sources[5]!,
          osm_type: 'way',
          osm_id: '30',
          tags: { natural: 'peak', name: ' ', int_name: 'Area summit' },
        },
        {
          ...sources[8]!,
          osm_type: 'relation',
          osm_id: '31',
          tags: {
            tourism: 'alpine_hut',
            type: 'site',
            name: '',
            'name:madeup': 'Unrecognized language',
            'name:de': 'Hüttenareal',
            'name:en': 'Hut site',
          },
        },
      ]),
    );
    const withExclusions = await prepareCatalogue(input);
    assert.equal(withExclusions.rows.length, 3);
    assert.deepEqual(withExclusions.manifest.source.exclusions, [
      {
        osm_type: 'way',
        osm_id: '30',
        name: 'Area summit',
        reason: 'unsupported_peak_or_pass_area',
      },
      {
        osm_type: 'relation',
        osm_id: '31',
        name: 'Hut site',
        reason: 'unsupported_hut_relation_type',
      },
    ]);
    assert.notEqual(
      withExclusions.manifest.catalogue_snapshot_id,
      result.manifest.catalogue_snapshot_id,
    );
    await writeFile(pbfPath, createPbfFixture(sources, { dense: true }));
    const corrupt = structuredClone(result);
    corrupt.coverage.coordinates[0]![0]![0]![0] = 6;
    assert.throws(() => validatePublishedCatalogue(corrupt));
    const original = await readFile(pbfPath);
    await writeFile(pbfPath, original.subarray(0, original.length - 1));
    await assert.rejects(prepareCatalogue(input), /Truncated/);
    await writeFile(pbfPath, createPbfFixture(sources, { omitMetadata: true }));
    await assert.rejects(prepareCatalogue(input));
    await writeFile(pbfPath, createPbfFixture([...sources, sources[0]!]));
    await assert.rejects(prepareCatalogue(input), /Duplicate selected/);
    await writeFile(
      pbfPath,
      createPbfFixture(sources.filter((source) => source.osm_id !== '12')),
    );
    await assert.rejects(prepareCatalogue(input), /Missing hut member way/);
    await writeFile(
      pbfPath,
      createPbfFixture(sources.filter((source) => source.osm_id !== '4')),
    );
    await assert.rejects(prepareCatalogue(input), /Missing hut node/);
    await writeFile(pbfPath, createPbfFixture(sources));
    await assert.rejects(
      prepareCatalogue({
        ...input,
        onProgress(message) {
          if (message.startsWith('Selecting'))
            writeFileSync(
              pbfPath,
              createPbfFixture(sources, { dataAsOf: '2026-10-24T00:00:00Z' }),
            );
        },
      }),
      /changed during preparation/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
