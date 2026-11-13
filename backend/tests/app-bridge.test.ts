import assert from 'node:assert/strict';

import { convexTest } from 'convex-test';
import test, { after, mock } from 'node:test';

import { createStreamSummariesHandler } from '../../src/app/api/v1/stream-summaries/handler';
import { createSyncBootstrapHandler } from '../../src/app/api/v1/sync/bootstrap/handler';
import { createSyncChangesHandler } from '../../src/app/api/v1/sync/changes/handler';
import { convexAppAdapter } from '../../src/server/library/convex';
import type { RawActivityStreams } from '../../src/server/strava/streams';
import { internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { encodeWhole } from '../recording/codec';
import { previewFixtureActivity } from './fixtures';
import { seedModule, testWrites } from './seed-api';

/**
 * End to end through the real v1 route handlers, the application adapter's
 * transport, the signed HTTP bridge and backend/convex, with data written by
 * the test-only seed functions (`./seed.ts`).
 */

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => mock.timers.reset());

const modules = {
  ...seedModule,
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './http.ts': () => import('../convex/http'),
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
  './recordingWorker.ts': () => import('../convex/recordingWorker'),
  './sync.ts': () => import('../convex/sync'),
};

const actor = {
  userId: 'app-owner',
  athleteId: 42,
  authentication: 'cookie' as const,
};
const scope = {
  userId: actor.userId,
  athleteId: '42',
  epoch: 'app-owner-epoch-0001',
};
const generation = 'app-generation-0001';
const catalogue = 'c'.repeat(64);
const matchingVersion = 'd'.repeat(64);
const ids = ['1001', '1002', '1003'];
const streams: RawActivityStreams = {
  time: {
    data: [0, 1, 2],
    original_size: 3,
    resolution: 'high',
    series_type: 'time',
  },
  distance: {
    data: [0, 5, 10],
    original_size: 3,
    resolution: 'high',
    series_type: 'time',
  },
};

function setEnv(t: test.TestContext, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

async function seed() {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation,
    catalogue,
    matchingVersion,
  });
  const common = { scope, generation, sourceRevision: 10 };
  const applied = await convex.mutation(testWrites.applySources, {
    ...common,
    items: ids.map((id, index) =>
      previewFixtureActivity(id, scope.athleteId, `Ride ${index}`, Date.now()),
    ),
    // Only the first activity has stored samples in the source.
    recordings: [{ id: ids[0]!, generation: 'pg-generation', revision: '7' }],
  });
  assert.deepEqual(applied, {
    applied: 3,
    needsRecording: [ids[0]],
    needsMatch: ids,
  });
  const { file, manifest } = encodeWhole(streams);
  const storageId = await convex.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array(file)])),
  );
  assert.equal(
    await convex.action(testWrites.prepareRecordings, {
      ...common,
      items: [
        {
          id: ids[0]!,
          file: storageId,
          manifest,
          recordingGeneration: 'pg-generation',
          recordingRevision: '7',
          fetchedAt: '2026-01-02T03:04:05.000Z',
        },
      ],
    }),
    1,
  );
  assert.equal(
    await convex.mutation(testWrites.publishMatches, {
      ...common,
      catalogue,
      items: [
        {
          activityId: ids[0]!,
          userId: scope.userId,
          status: 'complete',
          streamGeneration: 'pg-generation',
          streamRevision: '7',
          catalogueSnapshotId: null,
          matcherVersion: 'test',
          places: [],
        },
      ],
    }),
    1,
  );
  return convex;
}

function adapter(
  t: test.TestContext,
  convex: Awaited<ReturnType<typeof seed>>,
  epoch = scope.epoch,
) {
  const secret = 'e'.repeat(64);
  setEnv(t, {
    ACTIVITYMAP_CONVEX_SITE: 'https://convex.invalid',
    ACTIVITYMAP_CONVEX_KEY_ID: 'test',
    ACTIVITYMAP_CONVEX_SIGNING_KEY: secret,
    ACTIVITYMAP_BRIDGE_SIGNING_KEYS: JSON.stringify({ test: secret }),
  });
  const preview = convexAppAdapter(actor, epoch, (url, init) =>
    convex.fetch(new URL(String(url)).pathname, init),
  );
  assert(preview);
  return preview;
}

function bootstrapHandler(preview: ReturnType<typeof adapter>) {
  return createSyncBootstrapHandler({
    resolveActor: async () => actor,
    activitiesRepo: preview.activitiesRepo,
    photosRepo: preview.photosRepo,
    changesRepo: preview.changesRepo,
    cursorBackend: preview.cursorBackend,
    bootstrapPage: preview.bootstrapPage,
    defaultPageSize: 500,
    freshnessRepo: preview.freshnessRepo,
    placesRepo: preview.placesRepo,
  });
}

type Page = {
  items: {
    id: string;
    name: string;
    streams?: {
      state: string;
      fetched_at: string | null;
      available_types: string[];
    };
    placeMatches?: { status: string; matchingVersion?: string };
  }[];
  nextCursor: string | null;
  snapshotCursor: string | null;
};
async function json<T>(response: Response): Promise<T> {
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as { data: T }).data;
}

void test('v1 sync, summaries, streams, lists and status are served by backend/', async (t) => {
  const convex = await seed();
  const preview = adapter(t, convex);
  const bootstrap = bootstrapHandler(preview);

  const first = await json<Page>(
    await bootstrap(
      new Request('https://app.test/api/v1/sync/bootstrap?limit=2'),
    ),
  );
  assert.deepEqual(
    first.items.map((item) => item.id),
    ids.slice(0, 2),
  );
  assert(first.nextCursor && first.snapshotCursor);
  const [recorded, plain] = first.items;
  assert.equal(recorded!.streams?.state, 'current');
  assert.equal(recorded!.streams?.fetched_at, '2026-01-02T03:04:05.000Z');
  // Canonical order, not Convex's sorted object fields.
  assert.deepEqual(recorded!.streams?.available_types, ['time', 'distance']);
  assert.equal(recorded!.placeMatches?.status, 'complete');
  assert.equal(recorded!.placeMatches?.matchingVersion, matchingVersion);
  assert.equal(plain!.streams, undefined);
  assert.equal(plain!.placeMatches?.status, 'missing_streams');
  const rest = await json<Page>(
    await bootstrap(
      new Request(
        `https://app.test/api/v1/sync/bootstrap?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      ),
    ),
  );
  assert.deepEqual(
    rest.items.map((item) => item.id),
    [ids[2]],
  );
  assert.equal(rest.nextCursor, null);

  // A metadata-only change arrives through the change feed.
  await convex.mutation(testWrites.applySource, {
    scope,
    id: ids[0]!,
    generation,
    sourceRevision: 11,
    dto: previewFixtureActivity(
      ids[0]!,
      scope.athleteId,
      'Renamed',
      Date.now(),
    ),
  });
  const changes = createSyncChangesHandler({
    resolveActor: async () => actor,
    activitiesRepo: preview.activitiesRepo,
    photosRepo: preview.photosRepo,
    changesRepo: preview.changesRepo,
    cursorBackend: preview.cursorBackend,
    freshnessRepo: preview.freshnessRepo,
    placesRepo: preview.placesRepo,
  });
  const delta = await json<{
    items: {
      id: string;
      operation: string;
      activity?: Page['items'][number];
    }[];
  }>(
    await changes(
      new Request(
        `https://app.test/api/v1/sync/changes?cursor=${encodeURIComponent(first.snapshotCursor)}`,
      ),
    ),
  );
  assert.deepEqual(
    delta.items.map((item) => [
      item.id,
      item.operation,
      item.activity?.name,
      item.activity?.streams?.state,
    ]),
    [[ids[0], 'upsert', 'Renamed', 'current']],
  );

  const summaries = await json<{
    summaries: { activity_id: string; summary: unknown }[];
  }>(
    await createStreamSummariesHandler({
      resolveActor: async () => actor,
      repository: preview.streams,
    })(
      new Request(
        `https://app.test/api/v1/stream-summaries?ids=${ids.join(',')}`,
      ),
    ),
  );
  assert.deepEqual(
    summaries.summaries.map((item) => [
      item.activity_id,
      item.summary !== null,
    ]),
    [
      [ids[0], true],
      [ids[1], false],
      [ids[2], false],
    ],
  );

  const raw = await preview.streams.read(actor, ids[0]!);
  assert.deepEqual(raw?.payload, streams);
  assert.equal(
    (await preview.streams.read(actor, ids[1]!))?.payload ?? null,
    null,
  );

  const list = await preview.activitiesRepo.findPageByAthlete(42, { limit: 2 });
  assert.deepEqual(
    list.map((row) => row.id),
    [1001, 1002],
  );
  assert.deepEqual(
    await preview.photosRepo.findPageByAthlete(42, { limit: 10 }),
    [],
  );

  const status = await preview.loadStatus(actor, new Date());
  assert.equal(status.history.knownActivityCount, 3);
  assert.equal(status.streams.withData, 1);
  assert.equal(status.streams.runnable, 2);
  assert.equal(status.streams.scheduling, 'not_scheduled');
});

void test('a stale epoch in the preview configuration fails closed', async (t) => {
  const convex = await seed();
  const preview = adapter(t, convex, 'some-other-epoch-0001');
  const errors: unknown[] = [];
  const response = await createSyncBootstrapHandler({
    resolveActor: async () => actor,
    activitiesRepo: preview.activitiesRepo,
    photosRepo: preview.photosRepo,
    changesRepo: preview.changesRepo,
    cursorBackend: preview.cursorBackend,
    bootstrapPage: preview.bootstrapPage,
    freshnessRepo: preview.freshnessRepo,
    placesRepo: preview.placesRepo,
    onError: (error) => errors.push(error),
  })(new Request('https://app.test/api/v1/sync/bootstrap'));
  assert.equal(response.status, 500);
  assert.match(String(errors[0]), /bridge unavailable \(400\)/);
});

void test('re-imports replace a refreshed recording with a newer revision only', async () => {
  const convex = await seed();
  const common = { scope, generation, sourceRevision: 20 };
  const fixture = previewFixtureActivity(
    ids[0]!,
    scope.athleteId,
    'Ride 0',
    Date.now(),
  );
  const reimport = (revision: string) =>
    convex.mutation(testWrites.applySources, {
      ...common,
      sourceRevision: common.sourceRevision + Number(revision),
      items: [fixture],
      recordings: [{ id: ids[0]!, generation: `pg-${revision}`, revision }],
    });
  // Unchanged identity: nothing to upload or rematch.
  assert.deepEqual(
    await convex.mutation(testWrites.applySources, {
      ...common,
      items: [fixture],
      recordings: [{ id: ids[0]!, generation: 'pg-generation', revision: '7' }],
    }),
    { applied: 1, needsRecording: [], needsMatch: [] },
  );
  // The source refreshed its samples without a stream-source change.
  assert.deepEqual(await reimport('8'), {
    applied: 1,
    needsRecording: [ids[0]],
    needsMatch: [ids[0]],
  });
  const stage = async () => {
    const { file, manifest } = encodeWhole(streams);
    return {
      manifest,
      file: await convex.run((ctx) =>
        ctx.storage.store(new Blob([new Uint8Array(file)])),
      ),
    };
  };
  const prepare = async (revision: string) =>
    convex.action(testWrites.prepareRecordings, {
      ...common,
      sourceRevision: common.sourceRevision + 8,
      items: [
        {
          id: ids[0]!,
          ...(await stage()),
          recordingGeneration: `pg-${revision}`,
          recordingRevision: revision,
        },
      ],
    });
  const before = await convex.run(async (ctx) =>
    ctx.db.query('recordings').collect(),
  );
  assert.equal(await prepare('8'), 1);
  const after = await convex.run(async (ctx) =>
    ctx.db.query('recordings').collect(),
  );
  assert.deepEqual(
    after.map((recording) => recording.revision),
    ['8'],
  );
  assert.equal(
    await convex.run(async (ctx) => ctx.storage.get(before[0]!.file)),
    null,
    'the replaced file is deleted',
  );
  const row = await convex.query(internal.sync.read, {
    ...scope,
    operation: { kind: 'activityIds', ids: [ids[0]!] },
  });
  assert.equal(row[0]!.streams?.revision, '8');
  assert.equal(row[0]!.placeMatches, undefined, 'the old match is cleared');
  // Late or repeated fetches cannot replace the newer recording.
  assert.equal(await prepare('7'), 0);
  assert.equal(await prepare('8'), 0);
});
