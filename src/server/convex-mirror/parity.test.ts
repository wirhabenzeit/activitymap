import assert from 'node:assert/strict';

import test from 'node:test';

import type { ActivityDTO } from '~/contracts/v1/activity';
import type { ActivityStreamSummaryDTO } from '~/contracts/v1/activity-streams';
import type { PhotoDTO } from '~/contracts/v1/photo';

import {
  type ParityConvex,
  type ParityPostgres,
  checkParity,
  rotatingWindow,
} from './parity';

const HOUR = 60 * 60_000;
const NOW = 1_000 * HOUR;

type Item = { id: string; name: string; map_polyline?: string; rev?: string };
const activity = ({ id, name, map_polyline, rev = 'pg' }: Item) =>
  ({
    id,
    name,
    map_polyline,
    placeMatches: { activityId: id, resultRevision: rev },
  }) as unknown as ActivityDTO;
const summary = (id: string, value = 1) =>
  ({
    activity_id: id,
    summary: { value },
  }) as unknown as ActivityStreamSummaryDTO;
type Shot = { id: string; activity: string; caption?: string };
const photo = ({ id, activity, caption }: Shot) =>
  ({
    unique_id: id,
    activity_id: activity,
    caption: caption ?? null,
  }) as unknown as PhotoDTO;

/** In-memory backends. `reads` records which IDs each side was asked for. */
function sources({
  postgres,
  convex = postgres.map((item) => ({ ...item, rev: 'cx' })),
  changes = {},
  photos = [],
  convexPhotos = photos,
  photoChanges = {},
}: {
  postgres: Item[];
  convex?: Item[];
  changes?: Record<string, { sequence: number; ago: number }>;
  photos?: Shot[];
  convexPhotos?: Shot[];
  photoChanges?: Record<string, { sequence: number; ago: number }>;
}) {
  const photoReads: string[][] = [];
  const latest =
    (log: Record<string, { sequence: number; ago: number }>) =>
    async (ids: string[]) =>
      new Map(
        Object.entries(log)
          .filter(([id]) => ids.includes(id))
          .map(([id, change]) => [
            id,
            {
              sequence: change.sequence,
              changedAt: new Date(NOW - change.ago),
            },
          ]),
      );
  const shots = (items: Shot[], ids: string[]) =>
    items.filter((item) => ids.includes(item.activity)).map(photo);
  const reads: string[][] = [];
  const pick = (items: Item[], ids: string[]) =>
    items.filter((item) => ids.includes(item.id));
  const pg: ParityPostgres = {
    activityIds: async () =>
      postgres
        .map((item) => item.id)
        .sort((a, b) => Number(BigInt(a) - BigInt(b))),
    changedSince: async (since) =>
      Object.entries(changes)
        .filter(([, change]) => NOW - change.ago > since.getTime())
        .map(([id]) => id),
    latestChanges: latest(changes),
    latestPhotoChanges: latest(photoChanges),
    photos: async (ids) => {
      photoReads.push(ids);
      return shots(photos, ids);
    },
    activities: async (ids) => {
      reads.push(ids);
      return pick(postgres, ids).map(activity);
    },
    summaries: async (ids) =>
      pick(postgres, ids).map((item) => summary(item.id)),
  };
  const cx: ParityConvex = {
    activities: async (ids) => pick(convex, ids).map(activity),
    summaries: async (ids) => pick(convex, ids).map((item) => summary(item.id)),
    photos: async (ids) => shots(convexPhotos, ids),
  };
  return { postgres: pg, convex: cx, reads, photoReads };
}

const library = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: String(100 + i),
    name: `Run ${i}`,
  }));

void test('nothing is compared before the first copy starts', async () => {
  const { postgres, convex, reads } = sources({ postgres: library(3) });
  const report = await checkParity({
    position: null,
    postgres,
    convex,
    now: NOW,
  });
  assert.equal(report.status, 'ok');
  assert.equal(report.copy, 'not-started');
  assert.deepEqual(reads, []);
});

void test('identical data passes; result revisions are expected to differ', async () => {
  const { postgres, convex } = sources({ postgres: library(3) });
  const report = await checkParity({
    position: { sequence: 10, revision: 1 },
    postgres,
    convex,
    now: NOW,
  });
  assert.equal(report.status, 'ok');
  assert.equal(report.copy, 'complete');
  assert.deepEqual(report.compared, {
    activities: 3,
    summaries: 3,
    photos: 0,
  });
  assert.deepEqual(report.differences, {});
  assert.deepEqual(report.expectedDifferences, {
    'activity.placeMatches.resultRevision': 3,
  });
});

void test('differing, missing and extra activities are drift', async () => {
  const items = library(4);
  const { postgres, convex } = sources({
    postgres: items
      .slice(0, 3)
      .map((item, i) => (i === 0 ? { ...item, map_polyline: 'abc' } : item)),
    convex: [
      { ...items[0]!, map_polyline: 'xyz', rev: 'cx' },
      { ...items[1]!, name: 'Renamed', rev: 'cx' },
      // items[2] is missing; items[3] was deleted in Postgres.
      { ...items[3]!, rev: 'cx' },
    ],
    changes: { [items[3]!.id]: { sequence: 5, ago: HOUR } },
  });
  const report = await checkParity({
    position: { sequence: 10, revision: 1 },
    postgres,
    convex,
    now: NOW,
  });
  assert.equal(report.status, 'drift');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(report.differences).map(([field, { count }]) => [
        field,
        count,
      ]),
    ),
    {
      'activity.map_polyline': 1,
      'activity.name': 1,
      '<activity missing in convex>': 1,
      '<activity extra in convex>': 1,
      '<summary missing in convex>': 1,
      '<summary extra in convex>': 1,
    },
  );
  assert.equal(
    report.differences['activity.name']!.example,
    '101: "Run 1" != "Renamed"',
  );
  // Routes never appear in examples.
  assert.equal(
    report.differences['activity.map_polyline']!.example,
    '100: <5 chars> != <5 chars>',
  );
});

void test('changes the mirror has not checkpointed are in flight, not drift', async () => {
  const items = library(3);
  const { postgres, convex } = sources({
    postgres: items,
    convex: items.map((item) => ({ ...item, name: 'Stale', rev: 'cx' })),
    changes: {
      // Above the checkpoint.
      [items[0]!.id]: { sequence: 11, ago: HOUR },
      // Below it, but recent enough that a late commit may still be replayed.
      [items[1]!.id]: { sequence: 9, ago: 60_000 },
      // Settled: must match.
      [items[2]!.id]: { sequence: 9, ago: HOUR },
    },
  });
  const report = await checkParity({
    position: { sequence: 10, revision: 1 },
    postgres,
    convex,
    now: NOW,
  });
  assert.equal(report.inFlight, 2);
  assert.equal(report.compared.activities, 1);
  assert.deepEqual(Object.keys(report.differences), ['activity.name']);
  assert.match(report.differences['activity.name']!.example, /^102: /);
});

void test('during a full copy only activities it has passed are compared', async () => {
  const items = library(5);
  const { postgres, convex, reads } = sources({
    postgres: items,
    // Only the first three have been copied.
    convex: items.slice(0, 3).map((item) => ({ ...item, rev: 'cx' })),
    changes: {
      // Changed after the copy started: reaches Convex after the copy.
      [items[1]!.id]: { sequence: 30, ago: HOUR },
      [items[2]!.id]: { sequence: 15, ago: HOUR },
    },
  });
  const report = await checkParity({
    position: { sequence: 0, revision: 1, full: { after: '102', through: 20 } },
    postgres,
    convex,
    now: NOW,
  });
  assert.equal(report.status, 'ok');
  assert.equal(report.copy, 'in-progress');
  assert.equal(report.checkpoint, 20);
  assert.deepEqual(reads, [['100', '101', '102']]);
  assert.equal(report.inFlight, 1);
  assert.equal(report.compared.activities, 2);
});

void test('the sample is a rotating window plus recent changes', async () => {
  assert.deepEqual(rotatingWindow([1, 2, 3, 4, 5], 2, 0), [1, 2]);
  assert.deepEqual(rotatingWindow([1, 2, 3, 4, 5], 2, 2), [5]);
  assert.deepEqual(rotatingWindow([1, 2, 3, 4, 5], 2, 3), [1, 2]);
  assert.deepEqual(rotatingWindow([1, 2], 5, 7), [1, 2]);

  const items = library(10);
  const { postgres, convex, reads } = sources({
    postgres: items,
    changes: {
      [items[9]!.id]: { sequence: 3, ago: HOUR },
      // Older than a day: only covered by its window.
      [items[8]!.id]: { sequence: 2, ago: 48 * HOUR },
    },
  });
  await checkParity({
    position: { sequence: 10, revision: 1 },
    postgres,
    convex,
    now: NOW + HOUR, // window 1 of 4
    windowSize: 3,
  });
  assert.deepEqual(reads, [['103', '104', '105', '109']]);
});

void test('photo sets are compared, with private values kept out of examples', async () => {
  const { postgres, convex } = sources({
    postgres: library(3),
    photos: [
      { id: 'a', activity: '100', caption: 'Summit' },
      { id: 'b', activity: '100' },
      { id: 'c', activity: '101' },
    ],
    convexPhotos: [
      { id: 'a', activity: '100', caption: 'Old caption' },
      // b is missing; d was removed in Postgres but not in Convex.
      { id: 'c', activity: '101' },
      { id: 'd', activity: '102' },
    ],
  });
  const report = await checkParity({
    position: { sequence: 10, revision: 1, photos: null },
    postgres,
    convex,
    now: NOW,
  });
  assert.equal(report.status, 'drift');
  assert.equal(report.compared.photos, 3);
  assert.deepEqual(Object.keys(report.differences).sort(), [
    '<photo extra in convex>',
    '<photo missing in convex>',
    'photo.caption',
  ]);
  assert.doesNotMatch(
    report.differences['photo.caption']!.example,
    /Summit|Old caption/,
  );
});

void test('photo sets with changes in flight are skipped', async () => {
  const items = library(4);
  const { postgres, convex } = sources({
    postgres: items,
    photos: [
      { id: 'a', activity: '100' },
      { id: 'b', activity: '101' },
      { id: 'c', activity: '102' },
      { id: 'e', activity: '103', caption: 'New' },
    ],
    convexPhotos: [
      // a's activity changed after the checkpoint: its set is not compared.
      { id: 'b', activity: '101', caption: 'Stale' },
      { id: 'c', activity: '102' },
      // d was deleted in Postgres after the photo position.
      { id: 'd', activity: '102' },
      { id: 'e', activity: '103', caption: 'Old' },
    ],
    changes: { '100': { sequence: 30, ago: HOUR } },
    photoChanges: {
      // Above the photo position.
      b: { sequence: 25, ago: HOUR },
      d: { sequence: 26, ago: HOUR },
      // Below it, but too recent to have settled.
      e: { sequence: 5, ago: 60_000 },
    },
  });
  const report = await checkParity({
    position: { sequence: 28, revision: 1, photos: null, photoSequence: 20 },
    postgres,
    convex,
    now: NOW,
  });
  assert.equal(report.status, 'ok');
  assert.equal(report.compared.photos, 0);

  // Once the photo position has passed them, the same state is drift.
  const later = await checkParity({
    position: { sequence: 28, revision: 1, photos: null, photoSequence: 26 },
    postgres,
    convex,
    now: NOW,
  });
  assert.deepEqual(Object.keys(later.differences).sort(), [
    '<photo extra in convex>',
    'photo.caption',
  ]);
});

void test('photos are compared only where the catch-up pass has been', async () => {
  const shots = [
    { id: 'a', activity: '100' },
    { id: 'b', activity: '102' },
  ];
  const before = sources({
    postgres: library(3),
    photos: shots,
    convexPhotos: [],
  });
  const none = await checkParity({
    position: { sequence: 10, revision: 1 },
    postgres: before.postgres,
    convex: before.convex,
    now: NOW,
  });
  assert.equal(none.status, 'ok');
  assert.deepEqual(before.photoReads, [[]]);

  const during = sources({
    postgres: library(3),
    photos: shots,
    convexPhotos: shots.slice(0, 1),
  });
  const partial = await checkParity({
    position: { sequence: 10, revision: 1, photos: '101' },
    postgres: during.postgres,
    convex: during.convex,
    now: NOW,
  });
  assert.equal(partial.status, 'ok');
  assert.deepEqual(during.photoReads, [['100', '101']]);
  assert.equal(partial.compared.photos, 1);
});

void test('a recording Postgres gave up fetching is not drift', async () => {
  const { postgres, convex } = sources({ postgres: library(2) });
  const failed = (state: string) => ({
    generation: 'g1',
    state,
    fetch_status: 'failed',
  });
  const withFailure = (state: string): ParityPostgres => ({
    ...postgres,
    activities: async (ids) =>
      (await postgres.activities(ids)).map((item) =>
        item.id === '100'
          ? ({
              ...item,
              streams: failed(state),
              placeMatches: { ...item.placeMatches, streamGeneration: 'g1' },
            } as unknown as ActivityDTO)
          : item,
      ),
    summaries: async (ids) =>
      (await postgres.summaries(ids)).map((item) =>
        item.activity_id === '100'
          ? ({
              ...item,
              metadata: failed(state),
              last_error: { code: 'not_found' },
            } as unknown as ActivityStreamSummaryDTO)
          : item,
      ),
  });
  const check = (state: string) =>
    checkParity({
      position: { sequence: 10, revision: 1 },
      postgres: withFailure(state),
      convex,
      now: NOW,
    });

  const report = await check('not_fetched');
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.expectedDifferences, {
    'activity.placeMatches.resultRevision': 1,
    'recording.neverFetched': 1,
  });
  assert.deepEqual(report.compared, { activities: 2, summaries: 1, photos: 0 });

  // A failed refresh of a recording that is stored is still compared.
  assert.equal((await check('current')).status, 'drift');
});
