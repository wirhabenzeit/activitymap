import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { convexTest } from 'convex-test';
import test, { after, mock } from 'node:test';

import syncFixtures from '../../shared/sync-integrity-fixtures.v1.json';
import { createSyncChangesHandler } from '../../src/app/api/v1/sync/changes/handler';
import { responseEnvelope } from '../../src/contracts/v1/envelope';
import { syncChangesPageDTOSchema } from '../../src/contracts/v1/sync';
import { convexAppAdapter } from '../../src/server/preview/convex';
import { convexSyncBridge } from '../../src/server/sync/convex-bridge';
import { encodeSyncCursor } from '../../src/server/sync/cursor';
import { SyncRebootstrapRequiredError } from '../../src/server/sync/errors';
import { internal } from '../convex/_generated/api';
import { publishChange } from '../convex/activityWrites';
import { idKey } from '../convex/owners';
import schema from '../convex/schema';
import { encodeWhole } from '../recording/codec';
import { previewFixtureActivity } from './fixtures';
import { seedModule, testWrites } from './seed-api';

// Install once before convex-test wraps timer globals with invocation-local accessors.
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => mock.timers.reset());

const modules = {
  ...seedModule,
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './http.ts': () => import('../convex/http'),
  './ingestion.ts': () => import('../convex/ingestion'),
  './ingestionSweep.ts': () => import('../convex/ingestionSweep'),
  './ingestionWorker.ts': () => import('../convex/ingestionWorker'),
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
  './recordingWorker.ts': () => import('../convex/recordingWorker'),
  './sync.ts': () => import('../convex/sync'),
};

// convex-test 0.0.59's finishAllScheduledFunctions leaves MessageChannels open
// under node:test. Drain its scheduler directly; fail on stuck/failed jobs.
async function drainScheduled(convex: ReturnType<typeof convexTest>) {
  for (let i = 0; i < 100; i++) {
    mock.timers.runAll();
    await convex.finishInProgressScheduledFunctions();
    const jobs = await convex.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    assert(
      !jobs.some((job) => job.state.kind === 'failed'),
      'scheduled mutation failed',
    );
    // Reconciliation for an owner Convex writes for reschedules itself for
    // as long as the owner exists; it is not what these tests wait for.
    if (
      jobs.every(
        (job) =>
          job.state.kind === 'success' ||
          job.state.kind === 'canceled' ||
          job.name.startsWith('ingestion'),
      )
    )
      return;
  }
  assert.fail('Scheduled work did not drain');
}

const actor = { userId: 'owner', athleteId: 42 };
const scope = {
  ...actor,
  athleteId: String(actor.athleteId),
  epoch: 'test-owner-epoch-01',
};
const generation = 'test-generation-01';
const catalogue = 'a'.repeat(64);
const matchingVersion = 'b'.repeat(64);
const config = {
  ...scope,
  backend: 'convex' as const,
  generation,
  catalogue,
  matchingVersion,
};
const operation = {
  kind: 'bootstrap' as const,
  resource: 'activities' as const,
  after: null,
  limit: 500,
};
const source = { scope, id: '9007199254740993', generation, sourceRevision: 1 };
const fixture = previewFixtureActivity(
  source.id,
  scope.athleteId,
  'Test ride',
  Date.now(),
);

void test('new delta API works before and after a backend upgrade without changing its cursor', async (t) => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  const id = '1234';
  await convex.mutation(testWrites.applySource, {
    ...source,
    id,
    dto: { ...fixture, id },
  });
  const secret = 'a'.repeat(64);
  for (const [name, value] of Object.entries({
    ACTIVITYMAP_CONVEX_SITE: 'https://convex.invalid',
    ACTIVITYMAP_CONVEX_KEY_ID: 'current',
    ACTIVITYMAP_CONVEX_SIGNING_KEY: secret,
    ACTIVITYMAP_BRIDGE_SIGNING_KEYS: JSON.stringify({ current: secret }),
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const candidate = { ...actor, authentication: 'bearer' as const };
  let upgraded = false;
  const operations: string[] = [];
  const fetcher: typeof fetch = (url, init) => {
    const { operation } = JSON.parse(String(init?.body)) as {
      operation: { kind: string };
    };
    operations.push(operation.kind);
    if (!upgraded && operation.kind === 'changesPage')
      return Promise.resolve(new Response(null, { status: 400 }));
    return convex.fetch(new URL(String(url)).pathname, init);
  };
  const read = async (cursor: string) => {
    const library = convexAppAdapter(candidate, scope.epoch, fetcher);
    const handler = createSyncChangesHandler({
      ...library,
      resolveActor: async () => candidate,
      onError: (error) => {
        throw error;
      },
    });
    const response = await handler(
      new Request(
        `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(cursor)}&limit=500`,
      ),
    );
    assert.equal(response.status, 200);
    return responseEnvelope(syncChangesPageDTOSchema).parse(
      await response.json(),
    ).data;
  };
  const cursor = encodeSyncCursor({
    sequence: 0,
    athleteId: actor.athleteId,
    issuedAt: new Date(),
    backend: convexAppAdapter(candidate, scope.epoch, fetcher).cursorBackend,
  });
  const old = await read(cursor);
  assert.equal(old.items[0]!.activity!.id, id);
  assert.deepEqual(operations, [
    'changesPage',
    'retention',
    'head',
    'changes',
    'activityIds',
  ]);
  const empty = await read(old.nextCursor);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.nextCursor, old.nextCursor);
  upgraded = true;
  operations.length = 0;
  const fast = await read(cursor);
  assert.deepEqual(fast, old);
  assert.deepEqual(operations, ['changesPage']);
  upgraded = false;
  operations.length = 0;
  assert.deepEqual(
    await read(cursor),
    old,
    'backend rollback must restore the legacy path automatically',
  );
  assert.equal(operations[0], 'changesPage');
  assert(operations.includes('retention'));
});

void test('atomic delta includes current photo metadata and its deletion', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  const photo = syncFixtures.photo;
  await convex.run(async (ctx) => {
    const owner = (await ctx.db.query('owners').first())!;
    await ctx.db.insert('photos', {
      owner: owner._id,
      generation: owner.generation,
      sourceRevision: 1,
      activity: idKey(photo.activity_id),
      key: photo.unique_id,
      dto: photo,
    });
    await publishChange(ctx, owner, photo.unique_id, 'upsert', 'photo');
  });
  const read = (after: number) =>
    convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'changesPage', after, limit: 500 },
    });
  const first = await read(0);
  assert.deepEqual(first.items[0]!.photo, photo);
  await convex.run(async (ctx) => {
    const owner = (await ctx.db.query('owners').first())!;
    const row = (await ctx.db.query('photos').first())!;
    await ctx.db.delete('photos', row._id);
    await publishChange(ctx, owner, photo.unique_id, 'delete', 'photo');
  });
  const deleted = await read(1);
  assert.deepEqual(deleted.items, [
    {
      sequence: '2',
      entityType: 'photo',
      operation: 'delete',
      id: photo.unique_id,
    },
  ]);
});

void test('atomic delta pages preserve tombstones, skip superseded upserts and enforce scope and retention', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  await convex.mutation(testWrites.applySource, {
    ...source,
    dto: fixture,
  });
  const read = (after: number) =>
    convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'changesPage', after, limit: 500 },
    });
  const first = await read(0);
  assert.equal(first.lastSequence, 1);
  assert.deepEqual(
    first.items.map((item) => item.activity?.id),
    [source.id],
  );
  assert.equal(first.head.sequence, 1);
  assert.deepEqual((await read(1)).items, []);
  assert.equal((await read(1)).lastSequence, 1);
  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 2,
    dto: null,
  });
  const deleted = await read(0);
  assert.equal(deleted.lastSequence, 2);
  assert.deepEqual(deleted.items, [
    {
      sequence: '2',
      entityType: 'activity',
      operation: 'delete',
      id: source.id,
    },
  ]);
  await assert.rejects(read(3), /sync_rebootstrap_required/);
  await assert.rejects(
    convex.query(internal.sync.read, {
      ...scope,
      userId: 'another-owner',
      operation: { kind: 'changesPage', after: 0, limit: 500 },
    }),
  );
  await convex.run(async (ctx) => {
    const owner = (await ctx.db.query('owners').first())!;
    const head = (await ctx.db
      .query('ownerHeads')
      .withIndex('by_owner', (q) => q.eq('owner', owner._id))
      .unique())!;
    await ctx.db.patch('ownerHeads', head._id, { retentionFloor: 2 });
  });
  await assert.rejects(read(1), /sync_rebootstrap_required/);
});

void test('atomic deltas stop at the byte budget without acknowledging a deferred event', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  for (let i = 1; i <= 30; i++) {
    const id = String(i);
    await convex.mutation(testWrites.applySource, {
      ...source,
      id,
      dto: {
        ...previewFixtureActivity(
          id,
          scope.athleteId,
          'Large route',
          Date.now(),
        ),
        map_polyline: '?'.repeat(100_000),
      },
    });
  }
  let after = 0;
  const ids: string[] = [];
  while (true) {
    const page = await convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'changesPage', after, limit: 500 },
    });
    assert(
      new TextEncoder().encode(JSON.stringify(page.items)).length <=
        2 * 1024 * 1024,
    );
    if (!page.items.length) {
      assert.equal(page.lastSequence, after);
      break;
    }
    assert.equal(Number(page.items.at(-1)!.sequence), page.lastSequence);
    assert(page.lastSequence > after);
    ids.push(...page.items.map((item) => item.id));
    after = page.lastSequence;
  }
  assert.deepEqual(
    ids,
    Array.from({ length: 30 }, (_, i) => String(i + 1)),
  );
});

void test('publishes only the assigned owner’s current source, recording and catalogue', async () => {
  const convex = convexTest(schema, modules);
  const snapshot = () =>
    convex.query(internal.sync.read, { ...scope, operation });
  await convex.mutation(internal.owners.provision, config);
  await convex.mutation(testWrites.applySource, {
    ...source,
    dto: fixture,
  });
  assert.equal((await snapshot()).items[0].id, source.id);

  const { file: bytes, manifest } = encodeWhole({
    time: {
      data: [0, 1],
      original_size: 2,
      resolution: 'high',
      series_type: 'time',
    },
  });
  const stageFile = () =>
    convex.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)])));
  const publishRecording = {
    ...source,
    file: await stageFile(),
    manifest,
    recordingGeneration: 'test-recording-generation',
    recordingRevision: '1',
  };
  assert.equal(await convex.action(testWrites.prepare, publishRecording), true);
  const recording = await convex.run(
    async (ctx) => (await ctx.db.query('recordings').first())!._id,
  );
  const publishMatch = {
    ...source,
    recording,
    catalogue,
    result: {
      userId: scope.userId,
      activityId: source.id,
      status: 'complete' as const,
      streamGeneration: publishRecording.recordingGeneration,
      streamRevision: publishRecording.recordingRevision,
      catalogueSnapshotId: catalogue,
      matcherVersion: 'recipe',
      places: [],
    },
  };
  assert.equal(
    await convex.mutation(testWrites.publishMatch, publishMatch),
    true,
  );
  assert.equal((await snapshot()).items[0].placeMatches.resultRevision, '3');

  const changedCatalogue = 'c'.repeat(64);
  await convex.mutation(testWrites.selectCatalogue, {
    scope,
    catalogue: changedCatalogue,
    matchingVersion: 'd'.repeat(64),
  });
  assert.equal((await snapshot()).items[0].placeMatches, undefined);
  assert.equal(
    await convex.mutation(testWrites.publishMatch, publishMatch),
    false,
  );
  assert.deepEqual(
    await convex.mutation(internal.catalogue.next, {
      scope,
      catalogue: changedCatalogue,
    }),
    { done: true },
  );
  assert.equal((await snapshot()).head.sequence, 4);

  const newerSource = { ...source, sourceRevision: 2 };
  await convex.mutation(testWrites.applySource, {
    ...newerSource,
    dto: { ...fixture, name: 'Updated' },
  });
  assert.equal((await snapshot()).items[0].streams.state, 'current');
  assert.equal(
    await convex.action(testWrites.prepare, {
      ...publishRecording,
      file: await stageFile(),
    }),
    false,
  );
  await convex.mutation(testWrites.applySource, {
    ...newerSource,
    dto: null,
  });
  assert.deepEqual((await snapshot()).items, []);
  assert.equal(
    await convex.mutation(testWrites.applySource, {
      ...newerSource,
      dto: fixture,
    }),
    false,
  );
  const delta = await convex.query(internal.sync.read, {
    ...scope,
    operation: { kind: 'changes', after: 4, limit: 500 },
  });
  assert.deepEqual(
    delta.map(({ sequence, operation }) => [sequence, operation]),
    [
      [5, 'upsert'],
      [6, 'delete'],
    ],
  );

  await assert.rejects(
    convex.query(internal.sync.read, {
      ...scope,
      userId: 'foreign-user',
      operation,
    }),
  );
  await assert.rejects(
    convex.query(internal.sync.read, { ...scope, athleteId: '43', operation }),
  );
  await convex.mutation(internal.owners.revoke, scope);
  await assert.rejects(snapshot);
  await drainScheduled(convex);
});

void test('signed bridge derives scope from the actor and old routing epochs cannot return', async (t) => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);

  const secret = 'a'.repeat(64);
  const env = {
    ACTIVITYMAP_CONVEX_SITE: 'https://convex.invalid',
    ACTIVITYMAP_CONVEX_KEY_ID: 'current',
    ACTIVITYMAP_CONVEX_SIGNING_KEY: secret,
    ACTIVITYMAP_BRIDGE_SIGNING_KEYS: JSON.stringify({ current: secret }),
  };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const fetcher: typeof fetch = (url, options) => {
    const headers = new Headers(options?.headers);
    const expected = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(
        `activitymap-sync-v1\ncurrent\n${headers.get('X-ActivityMap-Timestamp')}\n${options?.body}`,
      )
      .digest('hex');
    // Tampered requests are checked by the receiving backend, not this helper.
    if (!String(options?.body).includes('other'))
      assert.equal(headers.get('X-ActivityMap-Signature'), expected);
    return convex.fetch(new URL(String(url)).pathname, options);
  };
  const bridge = convexSyncBridge(actor, fetcher)!;
  assert.deepEqual(await bridge.assignment(), {
    backend: 'convex',
    epoch: scope.epoch,
  });
  await assert.rejects(
    bridge.read({ kind: 'applySource' }, scope.epoch),
    /unavailable/,
  );
  const initial = await bridge.read(operation, scope.epoch);
  assert(initial && typeof initial === 'object' && 'resource' in initial);
  assert.equal(initial.resource, 'activities');
  const tamper: typeof fetch = (url, options) =>
    fetcher(url, {
      ...options,
      body: String(options?.body).replace('"owner"', '"other"'),
    });
  await assert.rejects(convexSyncBridge(actor, tamper)!.assignment);

  // Compaction can advance the floor after the client's separate preflight.
  assert.equal(await bridge.read({ kind: 'retention' }, scope.epoch), 0);
  await convex.mutation(testWrites.applySource, {
    ...source,
    dto: fixture,
  });
  await convex.run(async (ctx) => {
    const change = (await ctx.db.query('changes').first())!;
    await ctx.db.patch('changes', change._id, {
      changedAt: Date.now() - 91 * 86_400_000,
    });
  });
  await convex.mutation(internal.maintenance.compactChanges, {});
  const staleRead = { kind: 'changes', after: 0, limit: 10 };
  await assert.rejects(
    bridge.read(staleRead, scope.epoch),
    SyncRebootstrapRequiredError,
  );

  const next = {
    ...config,
    backend: 'postgres' as const,
    epoch: 'test-owner-epoch-02',
    expectedEpoch: scope.epoch,
  };
  await convex.mutation(internal.owners.provision, next);
  assert.deepEqual(await bridge.assignment(), {
    backend: 'postgres',
    epoch: next.epoch,
  });
  await assert.rejects(bridge.read(operation, scope.epoch));
  await assert.rejects(
    convex.mutation(internal.owners.provision, {
      ...config,
      expectedEpoch: next.epoch,
    }),
  );
});

void test('metadata changes preserve recordings, summaries and matches; source fields invalidate them', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  const assignmentBefore = await convex.run((ctx) =>
    ctx.db.query('owners').first(),
  );
  await convex.mutation(testWrites.applySource, {
    ...source,
    dto: fixture,
  });
  const encoded = encodeWhole({
    time: {
      data: [0, 1],
      original_size: 2,
      resolution: 'high',
      series_type: 'time',
    },
  });
  const file = await convex.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array(encoded.file)])),
  );
  await convex.action(testWrites.prepare, {
    ...source,
    file,
    manifest: encoded.manifest,
    recordingGeneration: 'recording-generation',
    recordingRevision: '1',
  });
  const recording = await convex.run(
    async (ctx) => (await ctx.db.query('recordings').first())!,
  );
  const result = {
    activityId: source.id,
    userId: scope.userId,
    status: 'complete' as const,
    streamGeneration: 'recording-generation',
    streamRevision: '1',
    catalogueSnapshotId: catalogue,
    matcherVersion: 'test',
    places: [],
  };
  await convex.mutation(testWrites.publishMatch, {
    ...source,
    recording: recording._id,
    catalogue,
    result,
  });
  const summary = () =>
    convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'summaries', ids: [source.id] },
    });
  const before = await summary();
  const metadata = { ...fixture, name: 'Renamed', kudos_count: 42 };
  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 2,
    dto: metadata,
  });
  const after = await convex.query(internal.sync.read, { ...scope, operation });
  assert.equal(after.items[0].name, 'Renamed');
  assert.equal(after.items[0].streams.state, 'current');
  assert.equal(after.items[0].placeMatches.status, 'complete');
  assert.deepEqual(await summary(), before);
  assert.equal(
    await convex.run(
      async (ctx) => (await ctx.db.query('recordings').first())!._id,
    ),
    recording._id,
  );
  assert.deepEqual(
    await convex.run((ctx) => ctx.db.query('owners').first()),
    assignmentBefore,
  );
  assert.equal(
    await convex.mutation(testWrites.publishMatch, {
      ...source,
      recording: recording._id,
      catalogue,
      result,
    }),
    false,
    'an already published match remains idempotent',
  );
  await drainScheduled(convex);
  assert(
    await convex.run(async (ctx) => !!(await ctx.storage.get(file))),
    'cleanup retains referenced file',
  );

  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 3,
    dto: { ...metadata, distance: (metadata.distance ?? 0) + 1 },
  });
  const invalidated = await convex.query(internal.sync.read, {
    ...scope,
    operation,
  });
  assert.equal(invalidated.items[0].streams.state, 'stale');
  assert.equal(invalidated.items[0].placeMatches, undefined);
  assert.equal((await summary())[0].summary, null);
  assert.equal(await convex.run((ctx) => ctx.storage.get(file)), null);
});

void test('projection upgrades degrade derived data without taking an owner or page offline', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  for (const id of ['1', '2', '3'])
    await convex.mutation(testWrites.applySource, {
      ...source,
      id,
      dto: { ...fixture, id },
    });
  await convex.run(async (ctx) => {
    const owner = (await ctx.db.query('owners').first())!;
    await ctx.db.patch('owners', owner._id, { projectionVersion: 0 });
    const rows = await ctx.db.query('activities').collect();
    await ctx.db.patch('activities', rows[0]!._id, {
      projection: { ...rows[0]!.projection!, version: 0 },
    });
    await ctx.db.patch('activities', rows[1]!._id, {
      projection: { ...rows[1]!.projection!, generation: 'obsolete' },
    });
  });
  const page = await convex.query(internal.sync.read, { ...scope, operation });
  assert.deepEqual(
    page.items.map((row) => row.id),
    ['1', '2', '3'],
  );
  assert(page.items.every((row) => !row.streams && !row.placeMatches));
  const ids = await convex.query(internal.sync.read, {
    ...scope,
    operation: { kind: 'activityIds', ids: ['1', '2', '3'] },
  });
  assert.equal(ids.length, 3);
  const summaries = await convex.query(internal.sync.read, {
    ...scope,
    operation: { kind: 'summaries', ids: ['1', '2', '3'] },
  });
  assert.equal(summaries.length, 3);
  assert(summaries.every((row) => row.summary === null));
  // An obsolete account generation is never hydrated into a current library.
  await convex.run(async (ctx) => {
    const row = (await ctx.db.query('activities').first())!;
    await ctx.db.patch('activities', row._id, { generation: 'obsolete' });
  });
  assert.equal(
    (await convex.query(internal.sync.read, { ...scope, operation })).items
      .length,
    2,
  );
});

void test('scheduled catalogue invalidation drains multiple pages and ignores superseded jobs', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  for (let i = 1; i <= 35; i++)
    await convex.mutation(testWrites.applySource, {
      ...source,
      id: String(i),
      dto: { ...fixture, id: String(i) },
    });
  await convex.run(async (ctx) => {
    for (const row of await ctx.db.query('activities').collect())
      await ctx.db.patch('activities', row._id, {
        projection: {
          ...row.projection!,
          match: {
            catalogue,
            value: {
              activityId: row.dto!.id,
              userId: scope.userId,
              status: 'complete',
              streamGeneration: 'recording-generation',
              streamRevision: '1',
              catalogueSnapshotId: catalogue,
              matcherVersion: 'test',
              places: [],
            },
          },
        },
      });
  });
  await convex.mutation(testWrites.selectCatalogue, {
    scope,
    catalogue: 'c'.repeat(64),
    matchingVersion: 'd'.repeat(64),
  });
  await convex.mutation(testWrites.selectCatalogue, {
    scope,
    catalogue: 'e'.repeat(64),
    matchingVersion: 'f'.repeat(64),
  });
  await drainScheduled(convex);
  const page = await convex.query(internal.sync.read, { ...scope, operation });
  assert.equal(page.head.sequence, 70);
  assert.equal(page.items.length, 35);
  assert(page.items.every((row) => !row.placeMatches));
  assert.equal(
    await convex.run(
      async (ctx) =>
        (await ctx.db.query('ownerHeads').first())!.catalogueAfter ?? null,
    ),
    null,
  );
});

void test('retention drains bounded batches, preserves recent changes and rejects compacted cursors', async () => {
  const convex = convexTest(schema, modules);
  const owner = await convex.mutation(internal.owners.provision, config);
  const expired = Date.now() - 91 * 86_400_000;
  await convex.run(async (ctx) => {
    for (let sequence = 1; sequence <= 260; sequence++)
      await ctx.db.insert('changes', {
        owner,
        sequence,
        entityType: 'activity',
        entityId: String(sequence),
        operation: 'delete',
        changedAt: expired,
      });
    await ctx.db.insert('changes', {
      owner,
      sequence: 261,
      entityType: 'activity',
      entityId: '261',
      operation: 'upsert',
      changedAt: Date.now(),
    });
    const head = (await ctx.db.query('ownerHeads').first())!;
    await ctx.db.patch('ownerHeads', head._id, { sequence: 261 });
  });
  assert.equal(
    await convex.mutation(internal.maintenance.compactChanges, {}),
    256,
  );
  await drainScheduled(convex);
  const floor = await convex.query(internal.sync.read, {
    ...scope,
    operation: { kind: 'retention' },
  });
  assert.equal(floor, 260);
  await assert.rejects(
    convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'changes', after: 259, limit: 500 },
    }),
  );
  const changes = await convex.query(internal.sync.read, {
    ...scope,
    operation: { kind: 'changes', after: 260, limit: 500 },
  });
  assert.deepEqual(
    changes.map((row) => row.sequence),
    [261],
  );
  assert.equal(
    (
      await convex.query(internal.sync.read, {
        ...scope,
        operation: { kind: 'head' },
      })
    ).sequence,
    261,
  );
  mock.timers.tick(91 * 86_400_000);
  await convex.mutation(internal.maintenance.compactChanges, {});
  assert.equal(
    await convex.run(
      async (ctx) => (await ctx.db.query('changes').collect()).length,
    ),
    0,
  );
  assert.equal(
    await convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'retention' },
    }),
    261,
  );
});

void test('rejected and malformed staged recordings are cleaned without deleting accepted files', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  await convex.mutation(testWrites.applySource, {
    ...source,
    dto: fixture,
  });
  const encoded = encodeWhole({});
  const stage = () =>
    convex.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array(encoded.file)])),
    );
  const file = await stage();
  const args = {
    ...source,
    file,
    manifest: encoded.manifest,
    recordingGeneration: 'generation',
    recordingRevision: '1',
  };
  assert.equal(
    await convex.action(testWrites.prepare, {
      ...args,
      sourceRevision: 99,
    }),
    false,
  );
  assert.equal(await convex.run((ctx) => ctx.storage.get(file)), null);
  const corrupt = await stage();
  await assert.rejects(
    convex.action(testWrites.prepare, {
      ...args,
      file: corrupt,
      manifest: { ...encoded.manifest, contentHash: '0'.repeat(64) },
    }),
  );
  assert.equal(await convex.run((ctx) => ctx.storage.get(corrupt)), null);
  await drainScheduled(convex);
});

void test('catalogue invalidation pauses at handoff and resumes under a fresh Convex epoch', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  await convex.mutation(testWrites.applySource, {
    ...source,
    dto: fixture,
  });
  const nextCatalogue = 'c'.repeat(64);
  const nextVersion = 'd'.repeat(64);
  await convex.mutation(testWrites.selectCatalogue, {
    scope,
    catalogue: nextCatalogue,
    matchingVersion: nextVersion,
  });
  const postgres = {
    ...config,
    backend: 'postgres' as const,
    catalogue: nextCatalogue,
    matchingVersion: nextVersion,
    epoch: 'test-postgres-epoch',
    expectedEpoch: scope.epoch,
  };
  await convex.mutation(internal.owners.provision, postgres);
  await drainScheduled(convex);
  assert.equal(
    await convex.run(
      async (ctx) => (await ctx.db.query('ownerHeads').first())!.catalogueAfter,
    ),
    '',
  );
  const resumed = {
    ...postgres,
    backend: 'convex' as const,
    epoch: 'test-resumed-epoch',
    expectedEpoch: postgres.epoch,
  };
  await convex.mutation(internal.owners.provision, resumed);
  await drainScheduled(convex);
  assert.equal(
    await convex.run(
      async (ctx) =>
        (await ctx.db.query('ownerHeads').first())!.catalogueAfter ?? null,
    ),
    null,
  );
  await assert.rejects(
    convex.query(internal.sync.read, { ...scope, operation }),
  );
  assert.equal(
    (
      await convex.query(internal.sync.read, {
        ...scope,
        epoch: resumed.epoch,
        operation,
      })
    ).items.length,
    1,
  );
});

void test('catalogue invalidation stops with its writer and is finished by the next one', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  // More activities than one continuation handles.
  const ids = Array.from({ length: 40 }, (_, index) => String(1000 + index));
  for (const id of ids)
    await convex.mutation(testWrites.applySource, {
      ...source,
      id,
      dto: { ...fixture, id },
    });
  const cursor = () =>
    convex.run(
      async (ctx) =>
        (await ctx.db.query('ownerHeads').first())!.catalogueAfter ?? null,
    );
  const head = async () =>
    (
      await convex.query(internal.sync.read, {
        ...scope,
        operation: { kind: 'head' },
      })
    ).sequence;
  const hand = (writer: 'postgres' | 'handoff' | 'convex', expected: number) =>
    convex.mutation(internal.owners.setWriter, {
      userId: scope.userId,
      athleteId: scope.athleteId,
      writer,
      expectedEpoch: expected,
    });
  const nextCatalogue = 'c'.repeat(64);
  await convex.mutation(testWrites.selectCatalogue, {
    scope,
    catalogue: nextCatalogue,
    matchingVersion: 'd'.repeat(64),
  });
  // The writer changes between selection and its queued continuation.
  assert.equal(await hand('handoff', 0), 1);
  const before = await head();
  await drainScheduled(convex);
  assert.equal(await cursor(), '', 'the cursor did not move');
  assert.equal(await head(), before, 'nothing was published');
  // A continuation queued for the old writer stays a no-op afterwards too.
  assert.deepEqual(
    await convex.mutation(internal.catalogue.next, {
      scope,
      catalogue: nextCatalogue,
      writer: 'postgres',
    }),
    { done: true },
  );
  assert.deepEqual(
    await convex.mutation(internal.catalogue.next, {
      scope,
      catalogue: nextCatalogue,
    }),
    { done: true },
  );
  assert.equal(await cursor(), '');

  // The next writer finishes it, across several continuations.
  assert.equal(await hand('convex', 1), 2);
  await drainScheduled(convex);
  assert.equal(await cursor(), null);
});

void test('metadata updates allow in-flight recording and first match publication, but source changes fence them', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  await convex.mutation(testWrites.applySource, {
    ...source,
    dto: fixture,
  });
  const encoded = encodeWhole({});
  const stage = () =>
    convex.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array(encoded.file)])),
    );
  const work = {
    ...source,
    manifest: encoded.manifest,
    recordingGeneration: 'in-flight-recording',
    recordingRevision: '1',
  };
  const file = await stage();
  const metadata = {
    ...fixture,
    name: 'Renamed during fetch',
    kudos_count: 20,
  };
  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 2,
    dto: metadata,
  });
  assert.equal(
    await convex.action(testWrites.prepare, { ...work, file }),
    true,
  );
  const recording = await convex.run(
    async (ctx) => (await ctx.db.query('recordings').first())!,
  );
  assert.equal(
    recording.sourceRevision,
    2,
    'summary association uses the current metadata revision',
  );
  assert(
    (
      await convex.query(internal.sync.read, {
        ...scope,
        operation: { kind: 'summaries', ids: [source.id] },
      })
    )[0].summary,
  );
  const match = {
    ...source,
    recording: recording._id,
    catalogue,
    result: {
      activityId: source.id,
      userId: scope.userId,
      status: 'complete' as const,
      streamGeneration: work.recordingGeneration,
      streamRevision: '1',
      catalogueSnapshotId: catalogue,
      matcherVersion: 'test',
      places: [],
    },
  };
  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 3,
    dto: { ...metadata, kudos_count: 21 },
  });
  assert.equal(
    await convex.mutation(testWrites.publishMatch, match),
    true,
    'first result survives metadata changes',
  );
  assert.equal(
    (await convex.query(internal.sync.read, { ...scope, operation })).items[0]
      .placeMatches.status,
    'complete',
  );

  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 4,
    dto: { ...metadata, private: !metadata.private },
  });
  assert.equal(await convex.mutation(testWrites.publishMatch, match), false);
  assert.equal(
    await convex.action(testWrites.prepare, {
      ...work,
      file: await stage(),
    }),
    false,
  );
  // Reverting source values must not resurrect jobs from the earlier source.
  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 5,
    dto: metadata,
  });
  assert.equal(
    await convex.action(testWrites.prepare, {
      ...work,
      file: await stage(),
    }),
    false,
  );
  const freshFile = await stage();
  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 6,
    dto: null,
  });
  await convex.mutation(testWrites.applySource, {
    ...source,
    sourceRevision: 7,
    dto: metadata,
  });
  assert.equal(
    await convex.action(testWrites.prepare, {
      ...work,
      sourceRevision: 5,
      file: freshFile,
    }),
    false,
    'delete/recreate invalidates in-flight work',
  );
  await drainScheduled(convex);
});

void test('orphaned change rows cannot block retention for other owners', async () => {
  const convex = convexTest(schema, modules);
  const orphan = await convex.mutation(internal.owners.provision, config);
  const other = await convex.mutation(internal.owners.provision, {
    ...config,
    userId: 'other-owner',
    athleteId: '43',
  });
  await convex.run(async (ctx) => {
    const head = (await ctx.db
      .query('ownerHeads')
      .withIndex('by_owner', (q) => q.eq('owner', orphan))
      .unique())!;
    await ctx.db.delete('ownerHeads', head._id);
    await ctx.db.delete('owners', orphan);
    for (const owner of [orphan, other])
      await ctx.db.insert('changes', {
        owner,
        sequence: 1,
        entityType: 'activity',
        entityId: '1',
        operation: 'delete',
        changedAt: Date.now() - 91 * 86_400_000,
      });
    const liveHead = (await ctx.db.query('ownerHeads').first())!;
    await ctx.db.patch('ownerHeads', liveHead._id, { sequence: 1 });
  });
  assert.equal(
    await convex.mutation(internal.maintenance.compactChanges, {}),
    2,
  );
  assert.equal(
    await convex.run(
      async (ctx) => (await ctx.db.query('changes').collect()).length,
    ),
    0,
  );
  assert.equal(
    await convex.run(
      async (ctx) => (await ctx.db.query('ownerHeads').first())!.retentionFloor,
    ),
    1,
  );
});

void test('bootstrap pages fill the byte budget and the bridge text matches the page', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, config);
  const polyline = 'x'.repeat(20_000);
  for (let i = 1; i <= 150; i++)
    await convex.mutation(testWrites.applySource, {
      ...source,
      id: String(1000 + i),
      dto: { ...fixture, id: String(1000 + i), map_polyline: polyline },
    });
  const seen: string[] = [];
  let after: string | null = null;
  for (let pages = 0; ; pages++) {
    assert(pages < 5, 'bootstrap did not finish');
    const op = { ...operation, after };
    const [page, text] = await Promise.all([
      convex.query(internal.sync.read, { ...scope, operation: op }),
      convex.query(internal.sync.bootstrapJson, { ...scope, operation: op }),
    ]);
    // Same page; only key order may differ from Convex's sorted values.
    assert.deepEqual(JSON.parse(text), page);
    const bytes = new TextEncoder().encode(JSON.stringify(page.items)).length;
    assert(bytes <= 2 * 1024 * 1024);
    if (page.more) {
      // Greedy: the next item would not have fit.
      const next = JSON.stringify(page.items[0]).length;
      assert(bytes + next + 1 > 2 * 1024 * 1024);
    }
    seen.push(...page.items.map((item) => item.id));
    if (!page.more) break;
    after = page.items.at(-1)!.id;
  }
  assert.deepEqual(
    seen,
    Array.from({ length: 150 }, (_, i) => String(1001 + i)),
  );
  const photos = await convex.query(internal.sync.bootstrapJson, {
    ...scope,
    operation: { ...operation, resource: 'photos' },
  });
  assert.deepEqual(
    JSON.parse(photos),
    await convex.query(internal.sync.read, {
      ...scope,
      operation: { ...operation, resource: 'photos' },
    }),
  );
});
