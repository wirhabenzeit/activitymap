import assert from 'node:assert/strict';

import test from 'node:test';

import type { ActivityDTO } from '~/contracts/v1/activity';
import type { ActivityStreamSummaryDTO } from '~/contracts/v1/activity-streams';

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

/** In-memory backends. `reads` records which IDs each side was asked for. */
function sources({
  postgres,
  convex = postgres.map((item) => ({ ...item, rev: 'cx' })),
  changes = {},
}: {
  postgres: Item[];
  convex?: Item[];
  changes?: Record<string, { sequence: number; ago: number }>;
}) {
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
    latestChanges: async (ids) =>
      new Map(
        Object.entries(changes)
          .filter(([id]) => ids.includes(id))
          .map(([id, change]) => [
            id,
            {
              sequence: change.sequence,
              changedAt: new Date(NOW - change.ago),
            },
          ]),
      ),
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
  };
  return { postgres: pg, convex: cx, reads };
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
  assert.deepEqual(report.compared, { activities: 3, summaries: 3 });
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
