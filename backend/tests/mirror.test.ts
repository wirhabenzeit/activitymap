import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { convexTest } from 'convex-test';
import test, { after, mock } from 'node:test';

import type { ActivityPlacesResponse } from '../../src/contracts/activity-places';
import type { PhotoDTO } from '../../src/contracts/v1/photo';
import { startLibrary } from '../../src/server/library/index';
import {
  placeRows,
  publishCatalogue,
} from '../../src/server/places/catalogue-publish';
import {
  LIVE_CATALOGUE,
  type PlaceRow,
  datasetFor,
  tileOf,
} from '../../src/server/places/catalogue-rows';
import { createSyntheticCatalogue } from '../../src/server/places/catalogue.fixture';
import {
  catalogueIdentity,
  matchingVersion,
} from '../../src/server/places/matching-version';
import type { RawActivityStreams } from '../../src/server/strava/streams';
import { sendEventToConvex } from '../../src/server/sync/convex-events';
import { convexWriteBridge } from '../../src/server/sync/convex-writer';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { previewFixtureActivity } from './fixtures';

/**
 * The signed write bridge end to end against backend/convex in convex-test:
 * its keys and nonces, the place catalogue publication, and provider events.
 */

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => mock.timers.reset());

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './bridge.ts': () => import('../convex/bridge'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './catalogueWorker.ts': () => import('../convex/catalogueWorker'),
  './http.ts': () => import('../convex/http'),
  './library.ts': () => import('../convex/library'),
  './livePlaces.ts': () => import('../convex/livePlaces'),
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

const row = (index: number): PlaceRow => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  displayName: `Peak ${index}`,
  kinds: ['peak'],
  subtypes: [],
  // Two quarter-degree tiles.
  location: { longitude: 8 + (index % 2) * 0.3, latitude: 46.1 },
  ...(index % 3 === 0 ? {} : { elevationM: 2000 + index }),
});

/** A complete rowset, as publications stored them before the live
 * catalogue. */
async function seedRowset(
  convex: ReturnType<typeof setup>['convex'],
  snapshotId: string,
  revision: string,
  rows: PlaceRow[],
) {
  const dataset = await datasetFor(snapshotId, revision);
  const metadata = await convex.run((ctx) =>
    ctx.storage.store(new Blob(['{}'])),
  );
  await convex.mutation(internal.places.begin, {
    dataset,
    snapshotId,
    revision,
    count: rows.length,
    metadata,
  });
  const { digest } = await convex.mutation(internal.places.importBatch, {
    dataset,
    after: '',
    places: rows,
  });
  await convex.mutation(internal.places.complete, { dataset, digest });
}

void test('a rowset is accepted only in order and when whole', async (t) => {
  const { convex } = setup(t);
  const rows = Array.from({ length: 7 }, (_, index) => row(index + 1));
  // Convex refuses rows out of order, more rows than announced, a dataset
  // started under another identity and an early completion.
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

void test('an artifact is published to the live catalogue after a reviewed dry run, and later only its changes', async (t) => {
  const { convex, fetcher, writer, upload } = setup(t);
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: 'c'.repeat(64),
    matchingVersion: 'd'.repeat(64),
  });
  await convex.mutation(internal.owners.setWriter, {
    userId: scope.userId,
    athleteId: scope.athleteId,
    writer: 'convex',
    expectedEpoch: 0,
  });
  // What the bridge was asked to apply.
  const applied: { upserts: PlaceRow[]; deletes: string[]; tiles: string[] }[] =
    [];
  const recording: typeof fetch = async (url, init) => {
    const { operation } = JSON.parse(String(init?.body));
    if (operation?.kind === 'applyBatch') {
      const { upserts, deletes, tiles } = operation;
      applied.push({ upserts, deletes, tiles });
    }
    return fetcher(url, init);
  };
  const publisher = convexWriteBridge(actor, recording)!;
  // The live catalogue's metadata file, by the URL convex-test gives it.
  const storage: typeof fetch = async (url) => {
    const sha256 = String(url).split('/api/storage/')[1];
    const text = await convex.run(async (ctx) => {
      const file = (await ctx.db.system.query('_storage').collect()).find(
        (item) => item.sha256 === sha256,
      );
      return file && (await ctx.storage.get(file._id))!.text();
    });
    return text === undefined
      ? new Response(null, { status: 404 })
      : new Response(text);
  };
  const catalogue = createSyntheticCatalogue({ regionId: 'v1-places' });
  const snapshotId = catalogue.manifest.catalogue_snapshot_id;
  const rows = placeRows(catalogue);
  const publish = (
    options: Partial<Parameters<typeof publishCatalogue>[0]> = {},
  ) =>
    publishCatalogue({
      catalogue,
      writer: publisher,
      upload,
      fetcher: storage,
      ...options,
    });
  const live = () =>
    convex.run(async (ctx) => ({
      rows: (await ctx.db.query('livePlaces').collect()).map(
        (item) => item.place,
      ),
      state: await ctx.db.query('placeCatalogueState').unique(),
      tiles: (await ctx.db.query('placeTileChanges').collect()).map(
        (item) => `${item.revision} ${item.tile}`,
      ),
      walks: (await ctx.db.system.query('_scheduled_functions').collect())
        .filter((job) => job.name === 'catalogue:rematchTiles')
        .map((job) => job.args[0]),
    }));
  /** A new library, as the app starts one. */
  const start = async (userId: string, athleteId: number) => {
    const who = { userId, athleteId };
    await startLibrary(who, {
      writer: convexWriteBridge(who, fetcher)!,
      recordAssignment: async () => {},
    });
    return convex.run(async (ctx) =>
      (await ctx.db.query('owners').collect()).find(
        (owner) => owner.userId === userId,
      ),
    );
  };
  const versionOf = (target: { snapshotId: string; revision: string }) => {
    const version = matchingVersion(target);
    return [catalogueIdentity(version), version];
  };

  // Before the live catalogue, a new library is matched against the newest
  // rowset.
  await seedRowset(convex, 'osm-places-v1:rowset', 'osm-rows-v1', [row(1)]);
  const early = await start('early-owner', 43);
  assert.deepEqual(
    [early!.catalogue, early!.matchingVersion],
    versionOf({ snapshotId: 'osm-places-v1:rowset', revision: 'osm-rows-v1' }),
  );

  // A dry run reports and writes nothing.
  const dry = await publish();
  assert.deepEqual(
    [dry.status, dry.snapshotId, dry.current, dry.count, dry.revision],
    ['would_publish', snapshotId, null, rows.length, undefined],
  );
  assert.deepEqual(dry.changes, {
    inserts: rows.length,
    updates: 0,
    moved: 0,
    deletes: 0,
    unchanged: 0,
  });
  assert.deepEqual(await live(), {
    rows: [],
    state: null,
    tiles: [],
    walks: [],
  });
  // Publishing needs what the dry run saw, and the serving region.
  await assert.rejects(publish({ apply: true }), /expectedCurrent/);
  await assert.rejects(
    publish({ apply: true, expectedCurrent: 'osm-places-v1:other' }),
    /review a new dry run/,
  );
  await assert.rejects(
    publish({
      catalogue: createSyntheticCatalogue({ regionId: 'switzerland' }),
    }),
    /region switzerland/,
  );

  const published = await publish({ apply: true, expectedCurrent: null });
  assert.deepEqual(
    [published.status, published.revision, published.affectedTiles],
    ['published', 1, new Set(rows.map((item) => tileOf(item.location))).size],
  );
  let after = await live();
  assert.deepEqual(
    after.rows.sort((x, y) => (x.id < y.id ? -1 : 1)),
    rows,
  );
  assert.deepEqual(
    [after.state?.revision, after.state?.snapshotId, after.state?.pending],
    [1, snapshotId, undefined],
  );
  assert.deepEqual(after.walks, [{ revision: 1 }]);
  assert.deepEqual(
    after.tiles.sort(),
    [...new Set(rows.map((item) => `1 ${tileOf(item.location)}`))].sort(),
  );
  // The live catalogue is now the latest: new libraries start on it, while
  // the library that started on the rowset stays there until it is adopted.
  assert.deepEqual(await convex.query(internal.places.latest, {}), {
    ...LIVE_CATALOGUE,
  });
  const late = await start('late-owner', 44);
  assert.deepEqual(
    [late!.catalogue, late!.matchingVersion],
    versionOf(LIVE_CATALOGUE),
  );
  assert.equal(
    (await start('early-owner', 43))!.matchingVersion,
    early!.matchingVersion,
  );

  // Publishing it again writes nothing.
  applied.length = 0;
  const again = await publish({ apply: true, expectedCurrent: snapshotId });
  assert.equal(again.status, 'unchanged');
  assert.deepEqual(applied, []);
  assert.equal((await live()).state?.revision, 1);

  // A newer artifact with one renamed place sends that place alone.
  const renamed = createSyntheticCatalogue({
    regionId: 'v1-places',
    dataAsOf: '2026-11-01T00:00:00Z',
    transformRows: (all) =>
      all.map((item) =>
        item.display_name === 'Synthetic summit'
          ? { ...item, display_name: 'Renamed summit' }
          : item,
      ),
  });
  const summit = placeRows(renamed).find(
    (item) => item.displayName === 'Renamed summit',
  )!;
  const update = await publish({
    catalogue: renamed,
    apply: true,
    expectedCurrent: snapshotId,
  });
  assert.deepEqual(
    [
      update.status,
      update.revision,
      update.changes.updates,
      update.coverageChanged,
    ],
    ['published', 2, 1, false],
  );
  assert.deepEqual(applied, [{ upserts: [summit], deletes: [], tiles: [] }]);
  after = await live();
  assert.deepEqual(
    [after.state?.revision, after.state?.snapshotId],
    [2, renamed.manifest.catalogue_snapshot_id],
  );
  assert(after.rows.some((item) => item.displayName === 'Renamed summit'));
  assert.deepEqual(after.walks, [{ revision: 1 }, { revision: 2 }]);
  assert(after.tiles.includes(`2 ${tileOf(summit.location)}`));
  assert.equal(after.tiles.filter((tile) => tile.startsWith('2 ')).length, 1);

  // A catalogue that lost most of its places is refused unless allowed.
  const smaller = createSyntheticCatalogue({
    regionId: 'v1-places',
    dataAsOf: '2026-11-02T00:00:00Z',
    transformRows: (all) => all.slice(0, 1),
  });
  const shrink = (allowLargeRetirement: boolean) =>
    publish({
      catalogue: smaller,
      apply: true,
      expectedCurrent: renamed.manifest.catalogue_snapshot_id,
      allowLargeRetirement,
    });
  await assert.rejects(shrink(false), /more than 20%/);
  assert.equal((await shrink(true)).status, 'published');
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
