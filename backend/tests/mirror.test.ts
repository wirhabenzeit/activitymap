import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { convexTest } from 'convex-test';
import test, { after, mock } from 'node:test';

import type { ActivityPlacesResponse } from '../../src/contracts/activity-places';
import type { PhotoDTO } from '../../src/contracts/v1/photo';
import {
  type MirrorActivity,
  type MirrorRecording,
  type MirrorSource,
  catalogueFor,
  mirrorOwner,
} from '../../src/server/convex-mirror/mirror';
import type { RawActivityStreams } from '../../src/server/strava/streams';
import { convexWriteBridge } from '../../src/server/sync/convex-writer';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { previewFixtureActivity } from './fixtures';

/**
 * Shadow writes end to end: an in-memory stand-in for Postgres, the real
 * mirror core, the signed write bridge and backend/convex in convex-test.
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
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
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

/** A minimal Postgres stand-in with a change feed. */
function fakePostgres() {
  const activities = new Map<string, MirrorActivity>();
  const recordings = new Map<string, MirrorRecording>();
  const matches = new Map<string, ActivityPlacesResponse>();
  const changes: { id: string; sequence: number; at: number }[] = [];
  const photos = new Map<string, PhotoDTO>();
  const photoChanges: { id: string; sequence: number; at: number }[] = [];
  let version = 'a'.repeat(64);
  let sequence = 0;
  const touch = (id: string) =>
    changes.push({ id, sequence: ++sequence, at: Date.now() });
  const db = {
    version: () => version,
    setVersion(next: string) {
      version = next;
    },
    upsert(id: string, name: string) {
      activities.set(id, previewFixtureActivity(id, '42', name, 0));
      touch(id);
    },
    /** Add or change a photo; only the photo itself is marked as changed. */
    photo(id: string, activityId: string, caption: string | null = null) {
      photos.set(id, {
        unique_id: id,
        activity_id: activityId,
        athlete_id: '42',
        activity_name: null,
        caption,
        type: 1,
        source: 1,
        urls: { '600': `https://photos.invalid/${id}` },
        sizes: { '600': [600, 400] },
        default_photo: false,
        location: null,
        uploaded_at: null,
        created_at: null,
        post_id: null,
        status: null,
        resource_state: 2,
      });
      photoChanges.push({ id, sequence: ++sequence, at: Date.now() });
    },
    removePhoto(id: string) {
      photos.delete(id);
      photoChanges.push({ id, sequence: ++sequence, at: Date.now() });
    },
    remove(id: string) {
      for (const [key, photo] of photos)
        if (photo.activity_id === id) photos.delete(key);
      activities.delete(id);
      recordings.delete(id);
      matches.delete(id);
      touch(id);
    },
    record(id: string, revision: string) {
      recordings.set(id, {
        id,
        generation: `gen-${revision}`,
        revision,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        payload: streams,
      });
      touch(id);
    },
    match(id: string) {
      const recording = recordings.get(id)!;
      matches.set(id, {
        activityId: id,
        userId: actor.userId,
        status: 'complete',
        streamGeneration: recording.generation,
        streamRevision: recording.revision,
        catalogueSnapshotId: null,
        matcherVersion: 'test',
        matchingVersion: version,
        places: [],
      });
      touch(id);
    },
  };
  const source: MirrorSource = {
    latestSequence: async () => sequence,
    async changedActivities(after, since, limit) {
      const latest = new Map<string, number>();
      for (const change of changes)
        if (change.sequence > after || change.at > since.getTime())
          latest.set(change.id, change.sequence);
      return [...latest]
        .map(([id, at]) => ({ id, sequence: at }))
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, limit);
    },
    async activityIds(after, limit) {
      return [...activities.keys()]
        .sort()
        .filter((id) => after === null || id > after)
        .slice(0, limit);
    },
    activities: async (ids) => ids.flatMap((id) => activities.get(id) ?? []),
    recordings: async (ids) =>
      ids.flatMap((id) => {
        const recording = recordings.get(id);
        return recording
          ? [
              {
                id,
                generation: recording.generation,
                revision: recording.revision,
              },
            ]
          : [];
      }),
    payloads: async (ids) => ids.flatMap((id) => recordings.get(id) ?? []),
    matches: async (ids) => ({
      version,
      results: ids.flatMap((id) => matches.get(id) ?? []),
    }),
    async changedPhotos(after, since, limit) {
      const latest = new Map<string, number>();
      for (const change of photoChanges)
        if (change.sequence > after || change.at > since.getTime())
          latest.set(change.id, change.sequence);
      return [...latest]
        .map(([id, at]) => ({ id, sequence: at }))
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, limit);
    },
    photoActivities: async (ids) =>
      ids.flatMap((id) => {
        const photo = photos.get(id);
        return photo ? [{ id, activityId: photo.activity_id }] : [];
      }),
    photos: async (activityIds) =>
      [...photos.values()].filter((photo) =>
        activityIds.includes(photo.activity_id),
      ),
  };
  return { db, source };
}

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

void test('the mirror copies, replays harmlessly and follows Postgres changes', async (t) => {
  const { convex, writer, upload, read, feed } = setup(t);
  const { db, source } = fakePostgres();
  db.upsert('101', 'First');
  db.upsert('102', 'Second');
  db.upsert('103', 'Third');
  db.record('101', '1');
  db.match('101');
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: catalogueFor(db.version()),
    matchingVersion: db.version(),
  });
  let clock = Date.now();
  const run = (full = false) =>
    mirrorOwner({ source, writer, upload, full, now: () => (clock += 1000) });

  const imported = await run(true);
  assert.equal(imported.applied, 3);
  assert.equal(imported.recordings, 1);
  assert.equal(imported.matches, 1);
  assert.equal(imported.complete, true);
  assert.equal(imported.checkpoint.sequence, 5);
  let items = (await read()).items;
  assert.deepEqual(
    items.map((item) => [
      item.id,
      item.streams?.revision,
      item.placeMatches?.status,
    ]),
    [
      ['101', '1', 'complete'],
      ['102', undefined, undefined],
      ['103', undefined, undefined],
    ],
  );

  // Replaying recent changes (the overlap window) publishes nothing new.
  const before = await feed();
  const replay = await run();
  assert.equal(replay.recordings, 0);
  assert.equal(replay.matches, 0);
  assert.equal(await feed(), before, 'identical state publishes no changes');

  // A rename, a stream refresh with its new match, and a deletion.
  db.upsert('102', 'Renamed');
  db.record('101', '2');
  db.match('101');
  db.remove('103');
  const incremental = await run();
  assert.equal(incremental.deleted, 1);
  assert.equal(incremental.recordings, 1);
  assert.equal(incremental.matches, 1);
  items = (await read()).items;
  assert.deepEqual(
    items.map((item) => [item.id, item.name, item.streams?.revision]),
    [
      ['101', 'First', '2'],
      ['102', 'Renamed', undefined],
    ],
  );
  assert.equal(items[0]!.placeMatches?.streamRevision, '2');
  assert(incremental.checkpoint.revision > imported.checkpoint.revision);

  // A Postgres catalogue switch is selected before matches publish.
  db.setVersion('b'.repeat(64));
  db.match('101');
  const switched = await run();
  assert.equal(switched.catalogueSelected, true);
  assert.equal(switched.matches, 1);
  items = (await read()).items;
  assert.equal(items[0]!.placeMatches?.matchingVersion, 'b'.repeat(64));
});

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

void test('a new owner is copied across runs and then mirrored incrementally', async (t) => {
  const { convex, writer, upload, read } = setup(t);
  const { db, source } = fakePostgres();
  for (let i = 0; i < 300; i++) db.upsert(String(1000 + i), `Ride ${i}`);
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: catalogueFor(db.version()),
    matchingVersion: db.version(),
  });
  // The clock jumps whenever a checkpoint is written, so the first run runs
  // out of time right after its first chunk.
  let clock = Date.now();
  const timedWriter: typeof writer = {
    write: async (operation, epoch) => {
      const result = await writer.write(operation, epoch);
      if (operation.kind === 'checkpoint') clock += 10_000;
      return result as never;
    },
  };
  const run = (deadline = Number.POSITIVE_INFINITY) =>
    mirrorOwner({
      source,
      writer: timedWriter,
      upload,
      now: () => clock,
      deadline,
    });

  const first = await run(clock + 1);
  assert.equal(first.mode, 'full');
  assert.equal(first.complete, false);
  assert.equal(first.applied, 64);
  assert.deepEqual(first.checkpoint.full, { after: '1063', through: 300 });

  const second = await run();
  assert.equal(second.mode, 'full');
  assert.equal(second.complete, true);
  assert.equal(second.applied, 236);
  assert.equal(second.checkpoint.full, undefined);
  assert.equal(second.checkpoint.sequence, 300);
  assert.equal((await read()).items.length, 300);

  db.upsert('1000', 'Renamed');
  const third = await run();
  assert.equal(third.mode, 'incremental');
  assert.equal((await read()).items[0]!.name, 'Renamed');
});

void test('a run that runs out of time mid-chunk resumes without redoing published work', async (t) => {
  const { convex, writer, read } = setup(t);
  const { db, source } = fakePostgres();
  for (let i = 0; i < 40; i++) {
    const id = String(2000 + i);
    db.upsert(id, `Ride ${i}`);
    db.record(id, '1');
  }
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: catalogueFor(db.version()),
    matchingVersion: db.version(),
  });
  // Every upload takes a second; the budget allows about one recording batch.
  let clock = Date.now();
  const slowUpload = async (_url: string, file: Uint8Array) => {
    clock += 1_000;
    return convex.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array(file)])),
    );
  };
  const run = (deadline = Number.POSITIVE_INFINITY) =>
    mirrorOwner({
      source,
      writer,
      upload: slowUpload,
      now: () => clock,
      deadline,
    });

  const first = await run(clock + 5_000);
  assert.equal(first.complete, false);
  assert.equal(first.recordings, 16, 'stops after the first recording batch');
  assert.equal(first.checkpoint.full, undefined, 'no partial chunk checkpoint');

  const second = await run();
  assert.equal(second.complete, true);
  assert.equal(second.recordings, 24, 'published recordings are not redone');
  const items = (await read()).items;
  assert.equal(items.length, 40);
  assert(items.every((item) => item.streams?.state === 'current'));
});

void test('photos follow their activities, their own changes and deletions', async (t) => {
  const { convex, writer, upload, feed } = setup(t);
  const { db, source } = fakePostgres();
  db.upsert('101', 'First');
  db.upsert('102', 'Second');
  db.photo('p-1', '101', 'Summit');
  db.photo('p-2', '101');
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: catalogueFor(db.version()),
    matchingVersion: db.version(),
  });
  let clock = Date.now();
  const run = (full = false) =>
    mirrorOwner({ source, writer, upload, full, now: () => (clock += 1000) });
  const stored = async () =>
    (
      await convex.query(internal.sync.read, {
        ...scope,
        operation: {
          kind: 'bootstrap',
          resource: 'photos',
          after: null,
          limit: 500,
        },
      })
    ).items as PhotoDTO[];
  const changesAfter = async (after: number) =>
    (await convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'changes', after, limit: 100 },
    })) as { entityType: string; entityId: string; operation: string }[];

  // A full copy carries each activity's photos and needs no catch-up.
  const imported = await run(true);
  assert.equal(imported.photos, 2);
  assert.equal(imported.checkpoint.photos, null);
  assert.deepEqual(
    (await stored()).map((photo) => [photo.unique_id, photo.caption]),
    [
      ['p-1', 'Summit'],
      ['p-2', null],
    ],
  );

  // Replaying the same state writes and publishes nothing.
  let before = await feed();
  assert.equal((await run()).photos, 0);
  assert.equal(await feed(), before);

  // Photo-only changes: a caption edit, a new photo and a removed one.
  db.photo('p-1', '101', 'Summit ridge');
  db.photo('p-3', '102');
  db.removePhoto('p-2');
  const incremental = await run();
  assert.equal(incremental.photos, 3);
  assert.deepEqual(
    (await stored()).map((photo) => [photo.unique_id, photo.caption]),
    [
      ['p-1', 'Summit ridge'],
      ['p-3', null],
    ],
  );
  assert.deepEqual(
    (await changesAfter(before))
      .map((row) => `${row.entityType} ${row.entityId} ${row.operation}`)
      .sort(),
    ['photo p-1 upsert', 'photo p-2 delete', 'photo p-3 upsert'],
  );
  assert.deepEqual(
    await convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'photoIds', ids: ['p-3', 'p-2'] },
    }),
    [(await stored())[1]],
  );
  // The checkpoint passed the photo changes, so the next run has nothing.
  clock += 16 * 60_000;
  mock.timers.tick(16 * 60_000);
  before = await feed();
  assert.equal((await run()).photos, 0);
  assert.equal(await feed(), before);

  // The live feed skips photo entries without failing on their IDs.
  const live = await convex
    .withIdentity({ subject: actor.userId, issuer: 'https://test.invalid' })
    .query(api.library.changes, { after: 0 });
  assert.equal(live.reload, false);

  // Deleting an activity removes its photos; clients drop them with it.
  db.remove('101');
  await run();
  assert.deepEqual(
    (await stored()).map((photo) => photo.unique_id),
    ['p-3'],
  );
});

void test('a library copied before photos were mirrored is caught up once', async (t) => {
  const { convex, writer, upload } = setup(t);
  const { db, source } = fakePostgres();
  db.upsert('101', 'First');
  db.upsert('102', 'Second');
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'shadow-generation-01',
    catalogue: catalogueFor(db.version()),
    matchingVersion: db.version(),
  });
  let clock = Date.now();
  const run = (full = false) =>
    mirrorOwner({ source, writer, upload, full, now: () => (clock += 1000) });
  await run(true);
  // The state an earlier version left: copied, with no photo position.
  await convex.run(async (ctx) => {
    const head = (await ctx.db.query('ownerHeads').first())!;
    const { photos: _photos, ...mirror } = head.mirror!;
    await ctx.db.patch('ownerHeads', head._id, { mirror });
  });
  // Photos that existed all along produce no fresh change to follow.
  db.photo('p-1', '101');
  db.photo('p-2', '102');
  clock += 16 * 60_000;
  mock.timers.tick(16 * 60_000);

  const caughtUp = await run();
  assert.equal(caughtUp.photos, 2);
  assert.equal(caughtUp.checkpoint.photos, null);
  const again = await run();
  assert.equal(again.photos, 0);
  assert.equal(again.checkpoint.photos, null);
});
