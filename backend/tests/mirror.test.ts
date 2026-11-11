import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { convexTest } from 'convex-test';
import test, { after, mock } from 'node:test';

import type { ActivityPlacesResponse } from '../../src/contracts/activity-places';
import type { PhotoDTO } from '../../src/contracts/v1/photo';
import type { PlaceRow } from '../../src/server/places/catalogue-rows';
import {
  type CatalogueSource,
  mirrorCatalogue,
} from '../../src/server/places/convex-catalogue';
import type { RawActivityStreams } from '../../src/server/strava/streams';
import { sendEventToConvex } from '../../src/server/sync/convex-events';
import { convexWriteBridge } from '../../src/server/sync/convex-writer';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { previewFixtureActivity } from './fixtures';

/**
 * The signed write bridge end to end against backend/convex in convex-test:
 * its keys and nonces, the place catalogue copy, and provider events.
 */

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => mock.timers.reset());

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './bridge.ts': () => import('../convex/bridge'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './http.ts': () => import('../convex/http'),
  './importer.ts': () => import('../convex/importer'),
  './library.ts': () => import('../convex/library'),
  './ingestion.ts': () => import('../convex/ingestion'),
  './ingestionSweep.ts': () => import('../convex/ingestionSweep'),
  './ingestionWorker.ts': () => import('../convex/ingestionWorker'),
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
  './places.ts': () => import('../convex/places'),
  './providerEvents.ts': () => import('../convex/providerEvents'),
  './recordingWorker.ts': () => import('../convex/recordingWorker'),
  './sync.ts': () => import('../convex/sync'),
};

const actor = { userId: 'shadow-owner', athleteId: 42 };
const scope = {
  userId: actor.userId,
  athleteId: '42',
  epoch: 'shadow-owner-epoch-01',
};
const writerSecret = 'f'.repeat(64);
const readerSecret = '1'.repeat(64);
const streams: RawActivityStreams = {
  time: {
    data: [0, 1],
    original_size: 2,
    resolution: 'high',
    series_type: 'time',
  },
};

function setup(t: test.TestContext) {
  const convex = convexTest(schema, modules);
  const env = {
    ACTIVITYMAP_CONVEX_SITE: 'https://convex.invalid',
    ACTIVITYMAP_CONVEX_WRITER_KEY_ID: 'writer',
    ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY: writerSecret,
    ACTIVITYMAP_BRIDGE_WRITER_KEYS: JSON.stringify({ writer: writerSecret }),
    ACTIVITYMAP_BRIDGE_SIGNING_KEYS: JSON.stringify({ reader: readerSecret }),
  };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const fetcher: typeof fetch = (url, init) =>
    convex.fetch(new URL(String(url)).pathname, init);
  const writer = convexWriteBridge(actor, fetcher)!;
  const upload = (_url: string, file: Uint8Array) =>
    convex.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(file)])));
  const read = async () =>
    convex.query(internal.sync.read, {
      ...scope,
      operation: {
        kind: 'bootstrap',
        resource: 'activities',
        after: null,
        limit: 500,
      },
    });
  const feed = async () =>
    (
      await convex.query(internal.sync.read, {
        ...scope,
        operation: { kind: 'head' },
      })
    ).sequence;
  return { convex, fetcher, writer, upload, read, feed };
}

void test('bridge writes need the writer key and a fresh nonce', async (t) => {
  const { convex, fetcher } = setup(t);
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: 'c'.repeat(64),
    matchingVersion: 'd'.repeat(64),
  });
  const signed = (key: string, keyId: string, body: string) => {
    const timestamp = String(Date.now());
    return fetcher('https://convex.invalid/internal/write/v1', {
      method: 'POST',
      headers: {
        'X-ActivityMap-Key-Id': keyId,
        'X-ActivityMap-Timestamp': timestamp,
        'X-ActivityMap-Signature': createHmac('sha256', Buffer.from(key, 'hex'))
          .update(`activitymap-write-v1\n${keyId}\n${timestamp}\n${body}`)
          .digest('hex'),
      },
      body,
    });
  };
  const body = JSON.stringify({
    ...scope,
    nonce: 'nonce-0000000000000001',
    operation: { kind: 'state' },
  });
  assert.equal((await signed(writerSecret, 'writer', body)).status, 200);
  assert.equal(
    (await signed(writerSecret, 'writer', body)).status,
    409,
    'a replayed nonce is rejected',
  );
  // The read bridge's key cannot authorize writes.
  const other = body.replace('0001', '0002');
  assert.equal((await signed(readerSecret, 'reader', other)).status, 401);
  const missingNonce = JSON.stringify({
    ...scope,
    operation: { kind: 'state' },
  });
  assert.equal(
    (await signed(writerSecret, 'writer', missingNonce)).status,
    400,
  );
  // A write for an epoch that is not current fails closed.
  const stale = JSON.stringify({
    ...scope,
    epoch: 'stale-owner-epoch-0001',
    nonce: 'nonce-0000000000000003',
    operation: { kind: 'uploadUrls', count: 1 },
  });
  assert.equal((await signed(writerSecret, 'writer', stale)).status, 400);
});

void test('the place catalogue is copied in order, resumably, and accepted only when whole', async (t) => {
  const { convex, writer, upload } = setup(t);
  // Upload URLs are issued only for a current owner assignment.
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: 'c'.repeat(64),
    matchingVersion: 'd'.repeat(64),
  });
  const row = (index: number): PlaceRow => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    displayName: `Peak ${index}`,
    kinds: ['peak'],
    subtypes: [],
    // Two quarter-degree tiles.
    location: { longitude: 8 + (index % 2) * 0.3, latitude: 46.1 },
    ...(index % 3 === 0 ? {} : { elevationM: 2000 + index }),
  });
  const rows = Array.from({ length: 7 }, (_, index) => row(index + 1));
  let revision = '4';
  const reads: string[] = [];
  const source: CatalogueSource = {
    current: async () => ({
      snapshotId: 'osm-places-v1:test',
      revision,
      count: rows.length,
      metadata: { manifest: { name: 'test' }, coverage: null },
    }),
    places: async (_snapshot, afterId, limit) => {
      reads.push(afterId);
      return rows.filter((item) => item.id > afterId).slice(0, limit);
    },
  };
  let clock = 0;
  const run = (deadline = Infinity) =>
    mirrorCatalogue({
      source,
      writer,
      upload,
      deadline,
      now: () => clock++,
      batchSize: 3,
    });
  const stored = (dataset: string) =>
    convex.run((ctx) =>
      ctx.db
        .query('places')
        .withIndex('by_dataset_key', (q) => q.eq('dataset', dataset))
        .collect(),
    );

  // The first run stops at its deadline after one batch.
  const first = await run(0);
  assert.equal(first.complete, false);
  assert.equal(first.stopped, 'deadline');
  assert.equal(first.imported, 3);
  // The next run continues after the last imported place and finishes.
  const second = await run();
  assert.deepEqual(reads, ['', rows[2]!.id, rows[5]!.id]);
  assert.equal(second.complete, true);
  assert.equal(second.sent, 4);
  assert.equal(second.dataset, first.dataset);
  const copied = await stored(first.dataset);
  assert.deepEqual(
    copied.map((item) => item.place),
    rows,
  );
  assert.deepEqual([...new Set(copied.map((item) => item.tile))].sort(), [
    '752,544',
    '753,544',
  ]);
  const metadata = await convex.run(async (ctx) => {
    const catalogue = await ctx.db.query('placeCatalogues').first();
    return (await ctx.storage.get(catalogue!.metadata))!.text();
  });
  assert.deepEqual(JSON.parse(metadata), {
    manifest: { name: 'test' },
    coverage: null,
  });

  // A complete rowset is never read or written again.
  reads.length = 0;
  const again = await run();
  assert.equal(again.complete, true);
  assert.equal(again.sent, 0);
  assert.deepEqual(reads, []);
  assert.equal((await stored(first.dataset)).length, 7);

  // A changed catalogue is another rowset; one that changes during its copy
  // is abandoned rather than accepted.
  revision = '5';
  const changing: CatalogueSource = {
    ...source,
    places: async (snapshot, afterId, limit) => {
      const page = await source.places(snapshot, afterId, limit);
      if (page.length < limit) revision = '6';
      return page;
    },
  };
  const abandoned = await mirrorCatalogue({
    source: changing,
    writer,
    upload,
    batchSize: 3,
  });
  assert.notEqual(abandoned.dataset, first.dataset);
  assert.equal(abandoned.complete, false);
  assert.equal(abandoned.stopped, 'catalogue changed');

  // Convex itself refuses rows out of order, more rows than announced, a
  // dataset started under another identity and an early completion.
  const dataset = 'e'.repeat(64);
  const file = await convex.run((ctx) => ctx.storage.store(new Blob(['{}'])));
  const begin = (count: number) =>
    convex.mutation(internal.places.begin, {
      dataset,
      snapshotId: 'osm-places-v1:other',
      revision: '1',
      count,
      metadata: file,
    });
  await begin(2);
  await assert.rejects(begin(3), /identity differs/);
  await assert.rejects(
    convex.mutation(internal.places.importBatch, {
      dataset,
      after: '',
      places: [rows[1]!, rows[0]!],
    }),
    /unordered/,
  );
  await assert.rejects(
    convex.mutation(internal.places.importBatch, {
      dataset,
      after: '',
      places: rows.slice(0, 3),
    }),
    /More rows than announced/,
  );
  const partial = await convex.mutation(internal.places.importBatch, {
    dataset,
    after: '',
    places: rows.slice(0, 1),
  });
  await assert.rejects(
    convex.mutation(internal.places.complete, {
      dataset,
      digest: partial.digest,
    }),
    /incomplete or differs/,
  );
  // A repeated batch for a position already passed changes nothing.
  const repeat = await convex.mutation(internal.places.importBatch, {
    dataset,
    after: '',
    places: rows.slice(0, 1),
  });
  assert.deepEqual(repeat, partial);
  const whole = await convex.mutation(internal.places.importBatch, {
    dataset,
    after: rows[0]!.id,
    places: rows.slice(1, 2),
  });
  await assert.rejects(
    convex.mutation(internal.places.complete, { dataset, digest: 'wrong' }),
    /incomplete or differs/,
  );
  assert.equal(
    (
      await convex.mutation(internal.places.complete, {
        dataset,
        digest: whole.digest,
      })
    ).complete,
    true,
  );
});

void test('provider events are recorded once, and only for an owner Convex writes', async (t) => {
  const { convex, fetcher } = setup(t);
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: 'c'.repeat(64),
    matchingVersion: 'd'.repeat(64),
  });
  const event = {
    event: 'inbox-event-0001',
    activityId: '101',
    aspect: 'create' as const,
    eventTime: 1_700_000_000_000,
  };
  const send = (item = event) => sendEventToConvex(actor, item, fetcher);
  const stored = () =>
    convex.run((ctx) => ctx.db.query('providerEvents').collect());

  // While Postgres writes, or during a handoff, the sender keeps the event.
  await assert.rejects(send(), /rejected recordEvents/);
  await convex.mutation(internal.owners.setWriter, {
    userId: scope.userId,
    athleteId: scope.athleteId,
    writer: 'handoff',
    expectedEpoch: 0,
  });
  await assert.rejects(send(), /rejected recordEvents/);
  assert.deepEqual(await stored(), []);

  await convex.mutation(internal.owners.setWriter, {
    userId: scope.userId,
    athleteId: scope.athleteId,
    writer: 'convex',
    expectedEpoch: 1,
  });
  await send();
  // Sent again after a lost response: still one record.
  await send();
  await send({ ...event, event: 'inbox-event-0002', aspect: 'delete' });
  assert.deepEqual(
    (await stored()).map((row) => [row.event, row.activity, row.aspect]),
    [
      ['inbox-event-0001', '101'.padStart(20, '0'), 'create'],
      ['inbox-event-0002', '101'.padStart(20, '0'), 'delete'],
    ],
  );
  await assert.rejects(
    send({ ...event, event: 'not a valid id' }),
    /rejected recordEvents/,
  );
});
