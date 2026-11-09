import assert from 'node:assert/strict';

import { convexTest } from 'convex-test';
import test, { after, mock } from 'node:test';

import { activityDTOSchema } from '../../src/contracts/v1/activity';
import type { RawActivityStreams } from '../../src/server/strava/streams';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { encodeWhole } from '../recording/codec';
import { previewFixtureActivity } from './fixtures';

// Scheduled rebuild steps run only when a test drives them explicitly.
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => mock.timers.reset());

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './importer.ts': () => import('../convex/importer'),
  './library.ts': () => import('../convex/library'),
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
  './recordingWorker.ts': () => import('../convex/recordingWorker'),
  './stats.ts': () => import('../convex/stats'),
  './sync.ts': () => import('../convex/sync'),
};

const scope = {
  userId: 'library-owner',
  athleteId: '42',
  epoch: 'library-owner-epoch-01',
};
const generation = 'library-generation-01';
const catalogue = 'c'.repeat(64);
const matchingVersion = 'd'.repeat(64);
const identity = { subject: scope.userId, issuer: 'https://test.invalid' };
const streams: RawActivityStreams = {
  time: {
    data: [0, 1],
    original_size: 2,
    resolution: 'high',
    series_type: 'time',
  },
};
const day = 86_400_000;
// Close to MAX_ACTIVITY_BYTES (256 KiB for DTO and projection together).
const LARGE_POLYLINE = 251 * 1024;
const series = (points: number, value: (i: number) => unknown) => ({
  data: Array.from({ length: points }, (_, i) => value(i)),
  original_size: points,
  resolution: 'high',
  series_type: 'distance',
});
/** A long recording with every series, so its chart summary is full size. */
const largeStreams = {
  time: series(3000, (i) => i),
  distance: series(3000, (i) => i * 7.3),
  latlng: series(3000, (i) => [47 + Math.sin(i) / 50, 8 + Math.cos(i) / 50]),
  altitude: series(3000, (i) => 400 + 300 * Math.sin(i / 37)),
  heartrate: series(3000, (i) => 120 + (i % 61)),
  watts: series(3000, (i) => 150 + ((i * 13) % 211)),
} as RawActivityStreams;
const base = Date.UTC(2026, 0, 1);

function activity(id: string, index: number, extra: object = {}) {
  return {
    ...previewFixtureActivity(
      id,
      scope.athleteId,
      `Ride ${index}`,
      base + index * day,
    ),
    map_polyline: `detailed-${id}`,
    map_summary_polyline: `summary-${id}`,
    geometry_state: 'summary' as const,
    ...extra,
  };
}

/** `large` activities carry near-maximum detailed polylines and run with
 * Convex's transaction limits (16 MiB read and written per transaction). */
async function setup(count: number, { large = false } = {}) {
  const convex = convexTest({ schema, modules, transactionLimits: large });
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation,
    catalogue,
    matchingVersion,
  });
  const items = Array.from({ length: count }, (_, i) =>
    activity(
      String(1000 + i),
      i,
      large ? { map_polyline: `${i}`.padEnd(LARGE_POLYLINE, 'x') } : {},
    ),
  );
  const batch = large ? 16 : 64;
  for (let i = 0; i < items.length; i += batch)
    await convex.mutation(internal.importer.applySources, {
      scope,
      generation,
      sourceRevision: 10,
      items: items.slice(i, i + batch),
      recordings: [],
    });
  return convex;
}

async function record(
  convex: Awaited<ReturnType<typeof setup>>,
  ids: string[],
  recorded: RawActivityStreams = streams,
) {
  const { file, manifest } = encodeWhole(recorded);
  const items = await Promise.all(
    ids.map(async (id) => ({
      id,
      file: await convex.run((ctx) =>
        ctx.storage.store(new Blob([new Uint8Array(file)])),
      ),
      manifest,
      recordingGeneration: 'pg-generation',
      recordingRevision: '1',
    })),
  );
  for (let i = 0; i < items.length; i += 16)
    await convex.action(internal.importer.prepareRecordings, {
      scope,
      generation,
      sourceRevision: 10,
      items: items.slice(i, i + 16),
    });
}

void test('live queries serve cards, detail, summaries and counts to the owner only', async () => {
  const convex = await setup(3);
  await record(convex, ['1000']);
  const viewer = convex.withIdentity(identity);

  await assert.rejects(
    convex.query(api.library.list, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
    /not_authorized/,
  );
  await assert.rejects(
    convex
      .withIdentity({ ...identity, subject: 'someone-else' })
      .query(api.library.status, {}),
    /not_authorized/,
  );

  const first = await viewer.query(api.library.list, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  assert.equal(first.isDone, false);
  const rest = await viewer.query(api.library.list, {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  assert.equal(rest.isDone, true);
  const cards = [...first.page, ...rest.page];
  assert.deepEqual(
    cards.map((card) => card.id),
    ['1000', '1001', '1002'],
  );
  // Cards are the v1 DTO minus the detailed polyline.
  for (const card of cards) {
    assert.equal('map_polyline' in card, false);
    activityDTOSchema.parse({ ...card, map_polyline: null });
  }
  assert.equal(cards[0]!.map_summary_polyline, 'summary-1000');
  assert.equal(cards[0]!.streams?.state, 'current');

  const detail = await viewer.query(api.library.activity, { id: '1000' });
  assert.equal(activityDTOSchema.parse(detail).map_polyline, 'detailed-1000');
  assert.equal(await viewer.query(api.library.activity, { id: '9' }), null);

  const summaries = await viewer.query(api.library.summaries, {
    ids: ['1000', '1001', '404'],
  });
  assert.deepEqual(
    summaries.map((item) => [item.activityId, item.summary !== null]),
    [
      ['1000', true],
      ['1001', false],
    ],
  );

  const status = await viewer.query(api.library.status, {});
  assert(status.ready);
  assert.equal(status.counts.total, 3);
  assert.equal(status.counts.withData, 1);
  assert.equal(status.counts.chartSummaries, 1);
  assert.equal(status.counts.runnable, 2);
  assert.equal(status.oldest, new Date(base).toISOString());
  assert.equal(status.newest, new Date(base + 2 * day).toISOString());
});

void test('write paths keep counts equal to a full recount, also during a rebuild', async () => {
  const convex = await setup(100);
  await record(convex, ['1003']);
  const viewer = convex.withIdentity(identity);
  const counts = async () => {
    const status = await viewer.query(api.library.status, {});
    assert(status.ready, 'counts are available');
    return status.counts;
  };
  const apply = (id: string, index: number, extra: object, revision: number) =>
    convex.mutation(internal.activityWrites.applySource, {
      scope,
      id,
      generation,
      sourceRevision: revision,
      dto: activity(id, index, extra),
    });

  // Rename (no count change), geometry refresh, stream-source change that
  // invalidates the recording, deletion and a new activity.
  await apply('1001', 1, { name: 'Renamed' }, 11);
  await apply('1002', 2, { geometry_state: 'detailed' }, 11);
  await apply('1003', 3, { distance: 1234 }, 11);
  await convex.mutation(internal.importer.deleteSources, {
    scope,
    generation,
    sourceRevision: 11,
    ids: ['1004'],
  });
  await apply('2000', 200, {}, 11);
  const incremental = await counts();
  assert.equal(incremental.total, 100);
  assert.equal(incremental.detailed, 1);
  assert.equal(incremental.withData, 0);
  assert.equal(incremental.invalidatedStreams, 1);

  // A rebuild that sees writes on both sides of its cursor.
  await convex.mutation(internal.stats.rebuild, { userId: scope.userId });
  assert.deepEqual(await viewer.query(api.library.status, {}), {
    ready: false,
  });
  const owner = await convex.run(
    async (ctx) => (await ctx.db.query('owners').first())!._id,
  );
  await convex.mutation(internal.stats.rebuildStep, { owner });
  // Counted already (behind the cursor) and not yet counted (ahead of it).
  await convex.mutation(internal.importer.deleteSources, {
    scope,
    generation,
    sourceRevision: 12,
    ids: ['1010', '1090'],
  });
  await apply('1080', 80, { geometry_state: 'detailed' }, 12);
  await convex.mutation(internal.stats.rebuildStep, { owner });
  const rebuilt = await counts();
  assert.equal(rebuilt.total, 98);
  assert.equal(rebuilt.detailed, 2);

  // A fresh recount agrees with the counts kept through all of the above.
  await convex.mutation(internal.stats.rebuild, { userId: scope.userId });
  for (let i = 0; i < 3; i++)
    await convex.mutation(internal.stats.rebuildStep, { owner });
  assert.deepEqual(await counts(), rebuilt);
});

void test('reads across many large activities stay within transaction limits', async () => {
  const count = 100;
  const convex = await setup(count, { large: true });
  const ids = Array.from({ length: count }, (_, i) => String(1000 + i));
  await record(convex, ids, largeStreams);
  const viewer = convex.withIdentity(identity);

  // A page stops at the read budget and continues where it stopped.
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const page: {
      page: { id: string }[];
      isDone: boolean;
      continueCursor: string;
    } = await viewer.query(api.library.list, {
      paginationOpts: { numItems: 256, cursor },
    });
    pages += 1;
    seen.push(...page.page.map((card) => card.id));
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  assert.deepEqual(seen, ids);
  assert(pages > 1, 'the byte budget split the library into several pages');

  const summaries = await viewer.query(api.library.summaries, {
    ids: ids.slice(0, 32),
  });
  assert.equal(summaries.filter((item) => item.summary).length, 32);
  await assert.rejects(
    viewer.query(api.library.summaries, { ids: ids.slice(0, 33) }),
    /Too many summary IDs/,
  );

  await convex.mutation(internal.stats.rebuild, { userId: scope.userId });
  const owner = await convex.run(
    async (ctx) => (await ctx.db.query('owners').first())!._id,
  );
  let status = await viewer.query(api.library.status, {});
  for (let step = 0; step < 50 && !status.ready; step++) {
    await convex.mutation(internal.stats.rebuildStep, { owner });
    status = await viewer.query(api.library.status, {});
  }
  assert(status.ready, 'the rebuild finished');
  assert.equal(status.counts.total, count);
  assert.equal(status.counts.chartSummaries, count);
});
