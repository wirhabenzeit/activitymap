import assert from 'node:assert/strict';

import test from 'node:test';

import {
  activityClusterPoint,
  createActivityClusterQueue,
} from './activity-clusters';

const at = (id: string, latitude: number, longitude: number) => ({
  id,
  locationHint: { start: [latitude, longitude] },
});

void test('a group starts with its oldest candidate, then takes closest routes across the pool', () => {
  const oldest = at('oldest', 47, 8);
  const distant = at('distant', 52, 13);
  const nearby = at('nearby', 47.01, 8);
  const closest = at('closest', 47.001, 8);
  const queue = createActivityClusterQueue([oldest, distant, nearby, closest]);
  assert.equal(queue.take(), oldest);
  assert.equal(queue.take(oldest), closest);
  assert.equal(queue.take(oldest), nearby);
  assert.equal(queue.take(oldest), undefined);
  assert.equal(
    queue.take(),
    distant,
    'The next group returns to the oldest remaining candidate',
  );
  assert.equal(queue.size, 0);
});

void test('groups use a fixed seed rather than chaining distant neighbours', () => {
  const seed = at('seed', 0, 0);
  const near = at('near', 0, 0.2);
  const chain = at('chain', 0, 0.4);
  const queue = createActivityClusterQueue([seed, near, chain]);
  queue.take();
  assert.equal(queue.take(seed), near);
  assert.equal(queue.take(seed), undefined);
  assert.equal(queue.take(), chain);
});

void test('missing geometry remains eligible and ties retain priority order', () => {
  const missing = { id: 'missing', locationHint: undefined };
  const seed = at('seed', 47, 8);
  const first = at('first', 47, 8);
  const second = at('second', 47, 8);
  const queue = createActivityClusterQueue([seed, missing, first, second]);
  queue.take();
  assert.equal(queue.take(seed), first);
  assert.equal(queue.take(seed), second);
  assert.equal(queue.take(seed), undefined);
  assert.equal(queue.take(), missing);
});

void test('summary bounds choose the route centre; invalid and wrapped bounds fall back to valid start GPS', () => {
  assert.deepEqual(
    activityClusterPoint({ bounds: [7, 46, 9, 48], start: [0, 0] }),
    { latitude: 47, longitude: 8 },
  );
  for (const bounds of [
    [0, 0, 0, 0],
    [8, 48, 7, 47],
    [-179, 47, 179, 48],
    [NaN, 0, 1, 1],
    [0, -91, 1, 1],
  ])
    assert.deepEqual(activityClusterPoint({ bounds, start: [47, 8] }), {
      latitude: 47,
      longitude: 8,
    });
  assert.equal(
    activityClusterPoint({ bounds: [Infinity], start: [91, 8] }),
    undefined,
  );
  assert.equal(activityClusterPoint({}), undefined);
});

void test('nearby routes across the antimeridian can share a group', () => {
  const seed = at('seed', 0, 179.99);
  const nearby = at('nearby', 0, -179.99);
  const queue = createActivityClusterQueue([seed, nearby]);
  queue.take();
  assert.equal(queue.take(seed), nearby);
});

void test('sparse groups can fill with the nearest distant routes and retain missing hints', () => {
  const seed = at('seed', 47, 8);
  const farthest = at('farthest', 52, 13);
  const nearest = at('nearest', 47, 9);
  const missing = { id: 'missing', locationHint: undefined };
  const queue = createActivityClusterQueue([seed, missing, farthest, nearest]);
  assert.equal(queue.take(), seed);
  assert.equal(queue.take(seed), undefined);
  assert.equal(queue.take(seed, true), nearest);
  assert.equal(queue.take(seed, true), farthest);
  assert.equal(queue.take(seed, true), missing);
  assert.equal(queue.size, 0);
});
