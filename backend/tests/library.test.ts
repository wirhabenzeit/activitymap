import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { convexTest } from 'convex-test';
import test, { after, mock } from 'node:test';

import { activityPlacesResponseSchema } from '../../src/contracts/activity-places';
import { activityDTOSchema } from '../../src/contracts/v1/activity';
import { createBatchActivityPlaceMatcher } from '../../src/server/application/batch-activity-places';
import {
  type PlaceRow,
  datasetFor,
} from '../../src/server/places/catalogue-rows';
import { createSyntheticCatalogue } from '../../src/server/places/catalogue.fixture';
import {
  SERVER_MATCHER_POLICY,
  matchingVersion as versionFor,
} from '../../src/server/places/matching-version';
import type { CandidatePlace } from '../../src/server/places/run-types';
import type { RawActivityStreams } from '../../src/server/strava/streams';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { encodeWhole } from '../recording/codec';
import { previewFixtureActivity } from './fixtures';
import { seedModule, testWrites } from './seed-api';

// Scheduled rebuild steps run only when a test drives them explicitly.
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => mock.timers.reset());

const modules = {
  ...seedModule,
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './library.ts': () => import('../convex/library'),
  './nativeSync.ts': () => import('../convex/nativeSync'),
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
  './places.ts': () => import('../convex/places'),
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
    await convex.mutation(testWrites.applySources, {
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
    await convex.action(testWrites.prepareRecordings, {
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
    convex.mutation(testWrites.applySource, {
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
  await convex.mutation(testWrites.deleteSources, {
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
  await convex.mutation(testWrites.deleteSources, {
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

void test('changes resumes from a sequence with current cards and deletions', async () => {
  const convex = await setup(3);
  const viewer = convex.withIdentity(identity);
  const apply = (id: string, index: number, extra: object, revision: number) =>
    convex.mutation(testWrites.applySource, {
      scope,
      id,
      generation,
      sourceRevision: revision,
      dto: activity(id, index, extra),
    });

  await assert.rejects(
    convex.query(api.library.changes, { after: null }),
    /not_authorized/,
  );
  // No position yet: load the library and continue from the head.
  const start = await viewer.query(api.library.changes, { after: null });
  assert(start.reload);
  assert.equal(start.sequence, 3);
  const nothing = await viewer.query(api.library.changes, {
    after: start.sequence,
  });
  assert(!nothing.reload);
  assert.equal(nothing.version, start.version);
  assert.deepEqual(
    [nothing.sequence, nothing.more, nothing.upserts, nothing.deletes],
    [3, false, [], []],
  );

  // Two writes to one activity collapse into its current card.
  await apply('1001', 1, { name: 'First' }, 11);
  await apply('1001', 1, { name: 'Second' }, 12);
  await convex.mutation(testWrites.deleteSources, {
    scope,
    generation,
    sourceRevision: 12,
    ids: ['1002'],
  });
  await apply('2000', 200, {}, 12);
  const next = await viewer.query(api.library.changes, { after: 3 });
  assert(!next.reload);
  assert.equal(next.sequence, 7);
  assert.deepEqual(
    next.upserts.map((item) => [item.id, item.name]),
    [
      ['1001', 'Second'],
      ['2000', 'Ride 200'],
    ],
  );
  for (const item of next.upserts) assert.equal('map_polyline' in item, false);
  assert.deepEqual(next.deletes, ['1002']);

  // Compacted history or a position this owner never reached: reload.
  await convex.run(async (ctx) => {
    const head = (await ctx.db.query('ownerHeads').first())!;
    await ctx.db.patch('ownerHeads', head._id, { retentionFloor: 5 });
  });
  const compacted = await viewer.query(api.library.changes, { after: 4 });
  assert(compacted.reload);
  assert.equal(compacted.sequence, 7);
  assert(!(await viewer.query(api.library.changes, { after: 5 })).reload);
  assert((await viewer.query(api.library.changes, { after: 99 })).reload);
});

void test('changes reads large libraries in batches within transaction limits', async () => {
  const count = 80;
  const convex = await setup(count, { large: true });
  const viewer = convex.withIdentity(identity);
  const seen: string[] = [];
  let after = 0;
  let reads = 0;
  for (;;) {
    const result = await viewer.query(api.library.changes, { after });
    assert(!result.reload);
    reads += 1;
    seen.push(...result.upserts.map((item) => item.id));
    after = result.sequence;
    if (!result.more) break;
  }
  assert.deepEqual(
    seen,
    Array.from({ length: count }, (_, i) => String(1000 + i)),
  );
  assert.equal(after, count);
  assert.equal(reads, 3, 'at most 32 activities per read');
});

void test('stored photos are counted, listed and announced in the feed', async () => {
  const convex = await setup(4);
  const viewer = convex.withIdentity(identity);
  const photo = (id: string, activityId: string) => ({
    unique_id: id,
    activity_id: activityId,
    athlete_id: scope.athleteId,
    activity_name: null,
    caption: null,
    type: 1,
    source: 1,
    urls: { '600': `https://photos.invalid/${id}` },
    sizes: { '600': [600, 400] as [number, number] },
    default_photo: false,
    location: null,
    uploaded_at: null,
    created_at: null,
    post_id: null,
    status: null,
    resource_state: 2,
  });
  const apply = (id: string, index: number, extra: object, revision: number) =>
    convex.mutation(testWrites.applySource, {
      scope,
      id,
      generation,
      sourceRevision: revision,
      dto: activity(id, index, extra),
    });
  const sets = (
    revision: number,
    items: { activityId: string; photos: ReturnType<typeof photo>[] }[],
  ) =>
    convex.mutation(testWrites.applyPhotoSets, {
      scope,
      generation,
      sourceRevision: revision,
      items,
    });
  const counts = async () => {
    const status = await viewer.query(api.library.status, {});
    assert(status.ready, 'counts are available');
    const { photoCount, activitiesWithPhotos, activitiesWithStoredPhotos } =
      status.counts;
    return { photoCount, activitiesWithPhotos, activitiesWithStoredPhotos };
  };
  const paged = async () => {
    const page = (await convex.query(internal.sync.read, {
      ...scope,
      operation: { kind: 'status', after: null },
    })) as { counts: Awaited<ReturnType<typeof counts>> };
    const { photoCount, activitiesWithPhotos, activitiesWithStoredPhotos } =
      page.counts;
    return { photoCount, activitiesWithPhotos, activitiesWithStoredPhotos };
  };

  // 1000 and 1001 report photos; 1002 holds one the provider does not count.
  await apply('1000', 0, { total_photo_count: 2 }, 11);
  await apply('1001', 1, { total_photo_count: 1 }, 11);
  const start = (await viewer.query(api.library.changes, { after: null }))
    .sequence;
  await sets(20, [
    { activityId: '1000', photos: [photo('a', '1000'), photo('b', '1000')] },
    { activityId: '1002', photos: [photo('c', '1002')] },
  ]);
  const expected = {
    photoCount: 3,
    activitiesWithPhotos: 2,
    activitiesWithStoredPhotos: 1,
  };
  assert.deepEqual(await counts(), expected);
  assert.deepEqual(await paged(), expected);

  // The feed announces the photo changes without activity cards.
  const feed = await viewer.query(api.library.changes, { after: start });
  assert(!feed.reload);
  assert.equal(feed.photos, true);
  assert.deepEqual(feed.upserts, []);
  const quiet = await viewer.query(api.library.changes, {
    after: feed.sequence,
  });
  assert(!quiet.reload);
  assert.equal(quiet.photos, false);

  const listed = await viewer.query(api.library.photos, { after: null });
  assert.deepEqual(
    listed.items.map((item) => item.unique_id),
    ['a', 'b', 'c'],
  );
  assert.equal(listed.next, null);
  await assert.rejects(
    convex.query(api.library.photos, { after: null }),
    /./,
    'the photo list needs a signed-in owner',
  );
  assert.deepEqual(
    (
      (await convex.query(internal.sync.read, {
        ...scope,
        operation: { kind: 'activityPhotos', ids: ['1002', '1000', '1003'] },
      })) as { unique_id: string }[]
    ).map((item) => item.unique_id),
    ['c', 'a', 'b'],
  );

  // A photo moves to another activity, one is removed, one activity with
  // photos is deleted and another starts reporting its photo.
  await sets(21, [
    { activityId: '1001', photos: [photo('b', '1001')] },
    { activityId: '1000', photos: [] },
  ]);
  assert.deepEqual(await counts(), {
    photoCount: 2,
    activitiesWithPhotos: 2,
    activitiesWithStoredPhotos: 1,
  });
  await convex.mutation(testWrites.deletePhotos, {
    scope,
    generation,
    sourceRevision: 22,
    ids: ['b'],
  });
  await apply('1002', 2, { total_photo_count: 1 }, 22);
  assert.deepEqual(await counts(), {
    photoCount: 1,
    activitiesWithPhotos: 3,
    activitiesWithStoredPhotos: 1,
  });
  await convex.mutation(testWrites.deleteSources, {
    scope,
    generation,
    sourceRevision: 23,
    ids: ['1002'],
  });
  const kept = {
    photoCount: 0,
    activitiesWithPhotos: 2,
    activitiesWithStoredPhotos: 0,
  };
  assert.deepEqual(await counts(), kept);

  // A recount agrees with the counts kept through the writes.
  await sets(24, [{ activityId: '1001', photos: [photo('d', '1001')] }]);
  const before = await counts();
  assert.deepEqual(before, {
    ...kept,
    photoCount: 1,
    activitiesWithStoredPhotos: 1,
  });
  await convex.mutation(internal.stats.rebuild, { userId: scope.userId });
  const owner = await convex.run(
    async (ctx) => (await ctx.db.query('owners').first())!._id,
  );
  await convex.mutation(internal.stats.rebuildStep, { owner });
  assert.deepEqual(await counts(), before);
  assert.deepEqual(await paged(), before);
});

void test('native bootstrap and deltas carry full DTOs, photo tombstones and transport-scoped cursors', async () => {
  const convex = await setup(3);
  const client = convex.withIdentity(identity);
  const bootstrap = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'activities',
      cursor: null,
    }),
  );
  assert.equal(bootstrap.items.length, 3);
  assert.equal(bootstrap.items[0].map_polyline, 'detailed-1000');
  assert(bootstrap.snapshotCursor.startsWith('ios-convex-v1:'));
  assert.equal(bootstrap.nextCursor, null);
  const { syncBootstrapPageDTOSchema, syncChangesPageDTOSchema } =
    await import('../../src/contracts/v1/sync');
  syncBootstrapPageDTOSchema.parse(bootstrap);
  const cursor = bootstrap.snapshotCursor;
  await convex.run(async (ctx) => {
    const owner = (await ctx.db.query('owners').first())!;
    const row = (await ctx.db.query('activities').first())!;
    await ctx.db.patch('activities', row._id, { deleted: true });
    const { publishChange } = await import('../convex/activityWrites');
    await publishChange(ctx, owner, row.dto!.id, 'delete');
    await publishChange(ctx, owner, 'removed-photo', 'delete', 'photo');
  });
  const delta = JSON.parse(
    await client.query(api.nativeSync.read, { resource: 'changes', cursor }),
  );
  syncChangesPageDTOSchema.parse(delta);
  assert.deepEqual(
    delta.items.map((item: { entityType: string; operation: string }) => [
      item.entityType,
      item.operation,
    ]),
    [
      ['activity', 'delete'],
      ['photo', 'delete'],
    ],
  );
  const caughtUp = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'changes',
      cursor: delta.nextCursor,
    }),
  );
  assert.equal(caughtUp.nextCursor, delta.nextCursor);
  assert.deepEqual(caughtUp.items, []);
  assert.equal(
    (await client.query(api.nativeSync.head, {})).sequence,
    JSON.parse(delta.nextCursor.slice('ios-convex-v1:'.length)).sequence,
  );
});

void test('native reads reject anonymous, other owners, expired positions, changed versions and HTTP cursors', async () => {
  const convex = await setup(1);
  const client = convex.withIdentity(identity);
  const page = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'activities',
      cursor: null,
    }),
  );
  await assert.rejects(convex.query(api.nativeSync.head, {}), /not_authorized/);
  await assert.rejects(
    convex
      .withIdentity({ ...identity, subject: 'someone-else' })
      .query(api.nativeSync.read, {
        resource: 'changes',
        cursor: page.snapshotCursor,
      }),
    /not_authorized/,
  );
  await convex.mutation(internal.owners.provision, {
    ...scope,
    userId: 'second-served-owner',
    athleteId: '43',
    backend: 'convex',
    generation,
    catalogue,
    matchingVersion,
  });
  await assert.rejects(
    convex
      .withIdentity({ ...identity, subject: 'second-served-owner' })
      .query(api.nativeSync.read, {
        resource: 'changes',
        cursor: page.snapshotCursor,
      }),
    /sync_rebootstrap_required/,
  );
  await assert.rejects(
    client.query(api.nativeSync.read, {
      resource: 'changes',
      cursor: 'HTTP-cursor',
    }),
    /sync_rebootstrap_required/,
  );
  await convex.run(async (ctx) => {
    const head = (await ctx.db.query('ownerHeads').first())!;
    await ctx.db.patch('ownerHeads', head._id, {
      retentionFloor: head.sequence + 1,
    });
  });
  await assert.rejects(
    client.query(api.nativeSync.read, {
      resource: 'changes',
      cursor: page.snapshotCursor,
    }),
    /sync_rebootstrap_required/,
  );
  await convex.run(async (ctx) => {
    const owner = (await ctx.db.query('owners').first())!;
    await ctx.db.patch('owners', owner._id, {
      generation: 'replacement-generation',
    });
  });
  await assert.rejects(
    client.query(api.nativeSync.read, {
      resource: 'changes',
      cursor: page.snapshotCursor,
    }),
    /sync_rebootstrap_required/,
  );
});

void test('native large-route pages stay bounded and reconcile writes during bootstrap from the first head', async () => {
  const convex = await setup(20, { large: true });
  const client = convex.withIdentity(identity);
  let page = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'activities',
      cursor: null,
    }),
  );
  const snapshot = page.snapshotCursor;
  // Insert behind the first page's key boundary: only catch-up can see it.
  await convex.mutation(testWrites.applySources, {
    scope,
    generation,
    sourceRevision: 11,
    items: [activity('999', 30)],
    recordings: [],
  });
  const seen = new Set<string>();
  do {
    assert(Buffer.byteLength(JSON.stringify(page)) < 600 * 1024);
    for (const item of page.items) {
      assert(!seen.has(item.id));
      seen.add(item.id);
    }
    if (!page.nextCursor) break;
    const before = page.nextCursor;
    page = JSON.parse(
      await client.query(api.nativeSync.read, {
        resource: 'activities',
        cursor: before,
      }),
    );
    assert.equal(page.snapshotCursor, null);
    assert.notEqual(page.nextCursor, before);
  } while (true);
  assert.equal(seen.size, 20);
  const delta = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'changes',
      cursor: snapshot,
    }),
  );
  assert.equal(delta.items[0].activity.id, '999');
  assert.equal(delta.items[0].activity.map_polyline, 'detailed-999');
});

void test('native positions survive matching/projection updates just like HTTP positions', async () => {
  const convex = await setup(20, { large: true });
  const client = convex.withIdentity(identity);
  const first = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'activities',
      cursor: null,
    }),
  );
  const before = await client.query(api.nativeSync.head, {});
  const nextVersion = 'e'.repeat(64);
  await convex.run(async (ctx) => {
    const owner = (await ctx.db.query('owners').first())!;
    await ctx.db.patch('owners', owner._id, {
      matchingVersion: nextVersion,
      catalogue: 'f'.repeat(64),
      projectionVersion: 2,
    });
  });
  const after = await client.query(api.nativeSync.head, {});
  assert.equal(after.sequence, before.sequence);
  assert.notEqual(after.version, before.version);
  const continuation = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'activities',
      cursor: first.nextCursor,
    }),
  );
  assert.equal(continuation.freshness.placeMatchingVersion, nextVersion);
  const changes = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'changes',
      cursor: first.snapshotCursor,
    }),
  );
  assert.equal(changes.nextCursor, first.snapshotCursor);
  assert.equal(changes.freshness.placeMatchingVersion, nextVersion);
  assert.deepEqual(changes.items, []);
});

void test('native and HTTP sync expose the stored reconciliation time, including metadata-only wakeups', async () => {
  const convex = await setup(1);
  const client = convex.withIdentity(identity);
  const before = await client.query(api.nativeSync.head, {});
  const completedAt = Date.now() - 60_000;
  await convex.run(async (ctx) => {
    const owner = (await ctx.db.query('owners').first())!;
    await ctx.db.insert('ingestionSweeps', {
      owner: owner._id,
      number: 1,
      phase: 'idle',
      dueAt: Date.now() + day,
      scanBefore: 0,
      page: 1,
      after: '',
      attempt: 0,
      claims: 0,
      completedAt,
    });
  });
  const head = await client.query(api.nativeSync.head, {});
  assert.equal(head.sequence, before.sequence);
  assert.equal(head.lastSummaryReconciledAt, completedAt);
  const first = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'activities',
      cursor: null,
    }),
  );
  const changes = JSON.parse(
    await client.query(api.nativeSync.read, {
      resource: 'changes',
      cursor: first.snapshotCursor,
    }),
  );
  assert.equal(
    first.freshness.lastSummaryReconciledAt,
    new Date(completedAt).toISOString(),
  );
  assert.equal(
    changes.freshness.lastSummaryReconciledAt,
    first.freshness.lastSummaryReconciledAt,
  );
  const http = await convex.query(internal.sync.read, {
    ...scope,
    operation: { kind: 'head' },
  });
  assert.equal(http.lastSummaryReconciledAt, completedAt);
  const httpBootstrap = JSON.parse(
    await convex.query(internal.sync.bootstrapJson, {
      ...scope,
      operation: {
        kind: 'bootstrap',
        resource: 'activities',
        after: null,
        limit: 10,
      },
    }),
  );
  assert.equal(httpBootstrap.head.lastSummaryReconciledAt, completedAt);
});

void test('native cursor expiry does not slide on empty polls, renews on advancement and shares compactor policy', async () => {
  const { SYNC_RETENTION_DAYS, SYNC_RETENTION_MS } =
    await import('../../src/contracts/v1/sync-policy');
  const original = Date.now();
  try {
    const convex = await setup(1);
    const client = convex.withIdentity(identity);
    const first = JSON.parse(
      await client.query(api.nativeSync.read, {
        resource: 'activities',
        cursor: null,
      }),
    );
    assert.equal(first.retention.retentionDays, SYNC_RETENTION_DAYS);
    assert.equal(
      Date.parse(first.retention.cursorValidUntil),
      original + SYNC_RETENTION_MS,
    );
    mock.timers.setTime(original + day);
    const empty = JSON.parse(
      await client.query(api.nativeSync.read, {
        resource: 'changes',
        cursor: first.snapshotCursor,
      }),
    );
    assert.equal(empty.nextCursor, first.snapshotCursor);
    assert.deepEqual(empty.retention, first.retention);
    await convex.mutation(testWrites.applySources, {
      scope,
      generation,
      sourceRevision: 11,
      items: [activity('2000', 30)],
      recordings: [],
    });
    const advanced = JSON.parse(
      await client.query(api.nativeSync.read, {
        resource: 'changes',
        cursor: first.snapshotCursor,
      }),
    );
    assert.equal(
      Date.parse(advanced.retention.cursorValidUntil),
      original + day + SYNC_RETENTION_MS,
    );
    mock.timers.setTime(original + SYNC_RETENTION_MS);
    await assert.rejects(
      client.query(api.nativeSync.read, {
        resource: 'changes',
        cursor: first.snapshotCursor,
      }),
      /sync_rebootstrap_required/,
    );
    const valid = JSON.parse(
      await client.query(api.nativeSync.read, {
        resource: 'changes',
        cursor: advanced.nextCursor,
      }),
    );
    assert.equal(valid.nextCursor, advanced.nextCursor);
  } finally {
    mock.timers.setTime(original);
  }
});
