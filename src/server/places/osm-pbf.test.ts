import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'node:test';

import { type OsmSource, scanPbf } from './osm-pbf';
import { createPbfFixture, pbfField, pbfFileBlock } from './osm-pbf.fixture';

const nodes: OsmSource[] = [
  {
    osm_type: 'node',
    osm_id: '9007199254740993',
    osm_version: 3,
    osm_timestamp: '2026-10-20T00:00:00Z',
    tags: JSON.parse(
      '{"name":"Exact summit","natural":"peak","__proto__":"original value"}',
    ) as Record<string, string>,
    point: { lon: -8.123456789, lat: 46.123456789 },
    point_derivation: 'osm_node',
  },
  {
    osm_type: 'node',
    osm_id: '9007199254740992',
    osm_version: 2,
    osm_timestamp: '2026-10-19T00:00:00Z',
    tags: {},
    point: { lon: -8.12, lat: 46.1 },
    point_derivation: 'osm_node',
  },
];
const sources: OsmSource[] = [
  ...nodes,
  {
    osm_type: 'way',
    osm_id: '9007199254740993',
    osm_version: 1,
    osm_timestamp: '2026-10-20T00:00:00Z',
    tags: { tourism: 'alpine_hut', name: 'Hut' },
    node_refs: nodes.map((source) => source.osm_id),
  },
  {
    osm_type: 'relation',
    osm_id: '9007199254740995',
    osm_version: 1,
    osm_timestamp: '2026-10-20T00:00:00Z',
    tags: { tourism: 'alpine_hut', name: 'Complex hut', type: 'multipolygon' },
    members: [
      { type: 'way', ref: '9007199254740993', role: 'outer' },
      { type: 'way', ref: '9007199254740991', role: 'inner' },
    ],
  },
];
void test('PBF raw/zlib, dense/sparse, packed/unpacked preserve exact IDs, negative deltas, metadata and tags', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'osm-reader-'));
  try {
    const path = join(directory, 'source.pbf');
    for (const dense of [false, true])
      for (const compressed of [false, true])
        for (const unpacked of [false, true]) {
          await writeFile(
            path,
            createPbfFixture(sources, { dense, compressed, unpacked }),
          );
          const actual: OsmSource[] = [];
          const header = await scanPbf(path, {
            select: () => true,
            onSource: (source) => actual.push(source),
          });
          assert.equal(header.dataAsOf, '2026-10-23T00:00:00Z');
          assert.deepEqual(actual, sources);
          assert.equal(Object.hasOwn(actual[0]!.tags, '__proto__'), true);
          const dependencies: OsmSource[] = [];
          await scanPbf(path, {
            nodeIds: new Set([nodes[1]!.osm_id]),
            onSource: (source) => dependencies.push(source),
          });
          assert.deepEqual(
            dependencies.map((source) => source.osm_id),
            [nodes[1]!.osm_id],
          );
        }
    await writeFile(
      path,
      createPbfFixture(sources, {
        dense: true,
        latOffset: -1000000,
        lonOffset: -2000000,
      }),
    );
    const offsetSources: OsmSource[] = [];
    await scanPbf(path, {
      select: () => true,
      onSource: (source) => offsetSources.push(source),
    });
    assert.deepEqual(offsetSources, sources);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
void test('PBF reader rejects history/features, missing timestamps, oversized blobs, malformed arrays and truncation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'osm-reader-invalid-'));
  try {
    const path = join(directory, 'source.pbf');
    const valid = createPbfFixture(sources);
    const oversizedHeader = Buffer.alloc(4);
    oversizedHeader.writeUInt32BE(65536);
    const malformed = pbfFileBlock(
      'OSMData',
      Buffer.concat([
        pbfField(1, pbfField(1, '')),
        pbfField(2, pbfField(2, pbfField(1, Buffer.from([2])))),
      ]),
    );
    const headerOnly = pbfFileBlock(
      'OSMHeader',
      Buffer.concat([pbfField(4, 'OsmSchema-V0.6'), pbfField(32, 1792713600)]),
    );
    const framedBlob = (blob: Buffer) => {
      const header = Buffer.concat([
        pbfField(1, 'OSMData'),
        pbfField(3, blob.length),
      ]);
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(header.length);
      return Buffer.concat([headerOnly, prefix, header, blob]);
    };
    const invalidIndex = pbfFileBlock(
      'OSMData',
      Buffer.concat([
        pbfField(1, pbfField(1, '')),
        pbfField(
          2,
          pbfField(
            1,
            Buffer.concat([
              pbfField(1, 2),
              pbfField(2, Buffer.from([99])),
              pbfField(3, Buffer.from([0])),
            ]),
          ),
        ),
      ]),
    );
    for (const bytes of [
      Buffer.alloc(0),
      valid.subarray(0, valid.length - 1),
      Buffer.concat([valid, Buffer.from([1])]),
      oversizedHeader,
      createPbfFixture(sources, {
        requiredFeatures: ['OsmSchema-V0.6', 'HistoricalInformation'],
      }),
      createPbfFixture(sources, {
        requiredFeatures: ['OsmSchema-V0.6', 'UnknownRequiredFeature'],
      }),
      pbfFileBlock('OSMHeader', pbfField(4, 'OsmSchema-V0.6')),
      headerOnly,
      Buffer.concat([headerOnly, malformed]),
      Buffer.concat([valid, valid]),
      Buffer.concat([headerOnly, pbfFileBlock('OSMData', Buffer.from([0x80]))]),
      Buffer.concat([headerOnly, invalidIndex]),
      framedBlob(Buffer.concat([pbfField(1, 'data'), pbfField(2, 123)])),
      framedBlob(pbfField(7, 'unsupported compression')),
      framedBlob(
        Buffer.concat([pbfField(1, 'raw'), pbfField(3, 'compressed')]),
      ),
    ]) {
      await writeFile(path, bytes);
      await assert.rejects(
        scanPbf(path, { select: () => true, onSource: () => undefined }),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
