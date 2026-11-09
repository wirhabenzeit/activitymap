import assert from 'node:assert/strict';

import test from 'node:test';

import { createShadowMirrorTrigger } from './trigger';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

void test('only shadow owners are mirrored, with a deadline from the budget', async () => {
  const runs: [string, number][] = [];
  const trigger = createShadowMirrorTrigger({
    owners: () => ['user-a'],
    run: async (userId, deadline) => void runs.push([userId, deadline]),
    now: () => 1_000,
    budgetMs: 500,
  });
  await trigger('user-b');
  await trigger('user-a');
  assert.deepEqual(runs, [['user-a', 1_500]]);

  const off = createShadowMirrorTrigger({
    owners: () => null,
    run: async () => assert.fail('shadow writes are off'),
  });
  await off('user-a');
});

void test('requests during a run start exactly one more run after it', async () => {
  const gates = [deferred(), deferred()];
  let started = 0;
  const trigger = createShadowMirrorTrigger({
    owners: () => ['user-a'],
    run: () => gates[started++]!.promise,
  });
  const first = trigger('user-a');
  const second = trigger('user-a');
  const third = trigger('user-a');
  assert.equal(started, 1, 'no second run while the first is in flight');
  gates[0]!.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(started, 2, 'the writes requested meanwhile get their own run');
  gates[1]!.resolve();
  await Promise.all([first, second, third]);
  assert.equal(started, 2);

  // Idle again: the next write starts a fresh run.
  gates.push(deferred());
  const next = trigger('user-a');
  gates[2]!.resolve();
  await next;
  assert.equal(started, 3);
});

void test('a failed run or invalid configuration is reported, never thrown', async () => {
  const errors: unknown[] = [];
  const failing = createShadowMirrorTrigger({
    owners: () => ['user-a'],
    run: async () => {
      throw new Error('bridge down');
    },
    onError: (error) => errors.push(error),
  });
  await failing('user-a');
  await failing('user-a');
  assert.equal(errors.length, 2, 'a failure does not wedge later runs');

  const invalid = createShadowMirrorTrigger({
    owners: () => {
      throw new Error('bad JSON');
    },
    run: async () => assert.fail('must not run'),
    onError: (error) => errors.push(error),
  });
  await invalid('user-a');
  assert.equal(errors.length, 3);
});
