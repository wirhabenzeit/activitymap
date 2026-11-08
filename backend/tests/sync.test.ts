import assert from 'node:assert/strict';

import { convexTest } from 'convex-test';
import test from 'node:test';

import { previewFixtureActivity } from '../../scripts/investigations/convex-geo/lab/convex/previewFixture';
import { convexSyncBridge } from '../../src/server/sync/convex-bridge';
import { internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { encodeWhole } from '../recording/codec';

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './http.ts': () => import('../convex/http'),
  './owners.ts': () => import('../convex/owners'),
  './recordingWorker.ts': () => import('../convex/recordingWorker'),
  './sync.ts': () => import('../convex/sync'),
};

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

void test('publishes only the assigned owner’s current source, recording and catalogue', async () => {
  const convex = convexTest(schema, modules);
  const snapshot = () =>
    convex.query(internal.sync.read, { ...scope, operation });
  await convex.mutation(internal.owners.provision, config);
  await convex.mutation(internal.activityWrites.applySource, {
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
  assert.equal(
    await convex.action(internal.recordingWorker.prepare, publishRecording),
    true,
  );
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
    await convex.mutation(internal.activityWrites.publishMatch, publishMatch),
    true,
  );
  assert.equal((await snapshot()).items[0].placeMatches.resultRevision, '3');

  const changedCatalogue = 'c'.repeat(64);
  await convex.mutation(internal.catalogue.select, {
    scope,
    catalogue: changedCatalogue,
    matchingVersion: 'd'.repeat(64),
  });
  assert.equal((await snapshot()).items[0].placeMatches, undefined);
  assert.equal(
    await convex.mutation(internal.activityWrites.publishMatch, publishMatch),
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
  await convex.mutation(internal.activityWrites.applySource, {
    ...newerSource,
    dto: { ...fixture, name: 'Updated' },
  });
  assert.equal((await snapshot()).items[0].streams.state, 'stale');
  assert.equal(
    await convex.action(internal.recordingWorker.prepare, {
      ...publishRecording,
      file: await stageFile(),
    }),
    false,
  );
  await convex.mutation(internal.activityWrites.applySource, {
    ...newerSource,
    dto: null,
  });
  assert.deepEqual((await snapshot()).items, []);
  assert.equal(
    await convex.mutation(internal.activityWrites.applySource, {
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
  const fetcher: typeof fetch = (url, options) =>
    convex.fetch(new URL(String(url)).pathname, options);
  const bridge = convexSyncBridge(actor, fetcher)!;
  assert.deepEqual(await bridge.assignment(), {
    backend: 'convex',
    epoch: scope.epoch,
  });
  const initial = await bridge.read(operation, scope.epoch);
  assert(initial && typeof initial === 'object' && 'resource' in initial);
  assert.equal(initial.resource, 'activities');
  const tamper: typeof fetch = (url, options) =>
    fetcher(url, {
      ...options,
      body: String(options?.body).replace('"owner"', '"other"'),
    });
  await assert.rejects(convexSyncBridge(actor, tamper)!.assignment);

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
