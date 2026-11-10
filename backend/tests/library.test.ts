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
  './places.ts': () => import('../convex/places'),
  './shadowMatching.ts': () => import('../convex/shadowMatching'),
  './shadowMatchingWorker.ts': () => import('../convex/shadowMatchingWorker'),
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

void test('changes resumes from a sequence with current cards and deletions', async () => {
  const convex = await setup(3);
  const viewer = convex.withIdentity(identity);
  const apply = (id: string, index: number, extra: object, revision: number) =>
    convex.mutation(internal.activityWrites.applySource, {
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
  await convex.mutation(internal.importer.deleteSources, {
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
    convex.mutation(internal.activityWrites.applySource, {
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
    convex.mutation(internal.importer.applyPhotoSets, {
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
  await convex.mutation(internal.importer.deletePhotos, {
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
  await convex.mutation(internal.importer.deleteSources, {
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

void test('the shadow matcher computes the results Postgres would and compares them', async () => {
  const convex = await setup(4);
  const synthetic = createSyntheticCatalogue();
  const snapshotId = synthetic.manifest.catalogue_snapshot_id;
  const revision = '7';
  const version = versionFor({ snapshotId, revision });
  const catalogueIdentity = createHash('sha256')
    .update(JSON.stringify({ postgresMatchingVersion: version }))
    .digest('hex');
  await convex.mutation(internal.catalogue.select, {
    scope,
    catalogue: catalogueIdentity,
    matchingVersion: version,
  });

  // The copied catalogue: one peak inside the synthetic coverage.
  const peak: PlaceRow = {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Synthetic',
    kinds: ['peak'],
    subtypes: ['peak'],
    location: { longitude: 8.123456789, latitude: 46.987654321 },
    elevationM: 100,
  };
  const dataset = await datasetFor(snapshotId, revision);
  const metadata = await convex.run((ctx) =>
    ctx.storage.store(
      new Blob([
        JSON.stringify({
          manifest: synthetic.manifest,
          coverage: synthetic.coverage,
        }),
      ]),
    ),
  );
  await convex.mutation(internal.places.begin, {
    dataset,
    snapshotId,
    revision,
    count: 1,
    metadata,
  });
  const imported = await convex.mutation(internal.places.importBatch, {
    dataset,
    after: '',
    places: [peak],
  });

  // 1000 passes the peak, 1001 is elsewhere in coverage, 1002 has no GPS and
  // 1003 has no recording.
  const stream = (data: unknown[]) => ({
    data,
    original_size: data.length,
    resolution: 'high',
    series_type: 'time',
  });
  const track = (latitude: number, longitude: number) =>
    ({
      latlng: stream(
        [-0.0001, 0, 0.0001].map((dx) => [latitude, longitude + dx]),
      ),
      time: stream([0, 10, 20]),
      distance: stream([0, 10, 20]),
      altitude: stream([100, 100, 100]),
    }) as RawActivityStreams;
  const recorded: Record<string, RawActivityStreams> = {
    '1000': track(peak.location.latitude, peak.location.longitude),
    '1001': track(46.5, 8.5),
    '1002': streams,
  };
  for (const [id, payload] of Object.entries(recorded))
    await record(convex, [id], payload);

  // What Postgres would have stored: the same matcher over the catalogue.
  const reference = createBatchActivityPlaceMatcher({
    snapshot: {
      catalogue: synthetic,
      places: [peak as CandidatePlace],
      revision,
    },
    policy: SERVER_MATCHER_POLICY,
  });
  const expected = [];
  for (const [id, payload] of Object.entries(recorded))
    expected.push(
      activityPlacesResponseSchema.parse(
        await reference.match({
          userId: scope.userId,
          activityId: id,
          input: {
            payload: payload.latlng ? payload : { ...payload, latlng: null },
            generation: 'pg-generation',
            revision: '1',
          },
        } as Parameters<typeof reference.match>[0]),
      ),
    );
  assert.deepEqual(
    expected.map((result) => [result.status, result.places.length]),
    [
      ['complete', 1],
      ['complete', 0],
      // An absent GPS channel reaches the matcher as null, as in Postgres.
      ['partial', 0],
    ],
  );
  // 1001's copied result is tampered with, to prove a difference is found.
  const copied = expected.map((result) =>
    result.activityId === '1001'
      ? { ...result, status: 'partial' as const }
      : result,
  );
  assert.equal(
    await convex.mutation(internal.importer.publishMatches, {
      scope,
      generation,
      sourceRevision: 10,
      catalogue: catalogueIdentity,
      items: copied,
    }),
    3,
  );

  // An incomplete rowset cannot be matched against.
  await assert.rejects(
    convex.mutation(internal.shadowMatching.start, { userId: scope.userId }),
    /No complete place catalogue/,
  );
  await convex.mutation(internal.places.complete, {
    dataset,
    digest: imported.digest,
  });
  const run = await convex.mutation(internal.shadowMatching.start, {
    userId: scope.userId,
  });
  const status = async () =>
    (
      await convex.query(internal.shadowMatching.status, {
        userId: scope.userId,
      })
    )[0]!;
  for (let step = 0; step < 10 && !(await status()).done; step++)
    await convex.action(internal.shadowMatchingWorker.run, { run });
  const finished = await status();
  assert.equal(finished.error, undefined);
  assert.equal(finished.done, true);
  assert.equal(finished.matched, 3);
  assert.equal(finished.skipped, 1);
  assert.deepEqual(finished.failed, []);

  for (let step = 0; step < 10 && !(await status()).comparison?.done; step++)
    await convex.mutation(internal.shadowMatching.compareStep, { run });
  const { comparison } = await status();
  assert(comparison?.done);
  assert.equal(comparison.same, 2);
  assert.equal(comparison.different, 1);
  assert.equal(comparison.neither, 1);
  assert.deepEqual(comparison.examples, [
    {
      key: comparison.examples[0]!.key,
      postgres: 'partial, 0 places',
      shadow: 'complete, 0 places',
    },
  ]);

  // Shadow results never reach clients: 1001 still serves the copied one.
  const viewer = convex.withIdentity(identity);
  const served = await viewer.query(api.library.activity, { id: '1001' });
  assert.equal(served?.placeMatches?.status, 'partial');

  // A run against a rowset the owner's results were not computed with stops.
  await convex.mutation(internal.catalogue.select, {
    scope,
    catalogue: 'a'.repeat(64),
    matchingVersion: 'b'.repeat(64),
  });
  const mismatched = await convex.mutation(internal.shadowMatching.start, {
    userId: scope.userId,
  });
  await convex.action(internal.shadowMatchingWorker.run, { run: mismatched });
  assert.match((await status()).error ?? '', /differs from the owner/);
});
