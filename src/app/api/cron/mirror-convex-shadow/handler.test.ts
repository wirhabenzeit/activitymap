import assert from 'node:assert/strict';

import test from 'node:test';

import {
  MAX_CHAINED_RUNS,
  createConvexShadowCronHandler,
  shadowOwners,
  shouldContinue,
} from './handler';

const request = (secret?: string) =>
  new Request('https://app.test/api/cron/mirror-convex-shadow', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });

void test('shadow writes stay off until owners are configured', async () => {
  assert.equal(shadowOwners(undefined), null);
  assert.deepEqual(shadowOwners('["a","b"]'), ['a', 'b']);
  assert.throws(() => shadowOwners('{"a":1}'));
  const handler = createConvexShadowCronHandler({
    owners: () => null,
    secret: () => 'secret',
    run: async () => assert.fail('must not run'),
  });
  assert.equal((await handler(request('secret'))).status, 503);
});

void test('the cron secret is required and checked', async () => {
  const run = async () => assert.fail('must not run');
  const unconfigured = createConvexShadowCronHandler({
    owners: () => ['a'],
    secret: () => undefined,
    run,
  });
  assert.equal((await unconfigured(request('x'))).status, 500);
  const handler = createConvexShadowCronHandler({
    owners: () => ['a'],
    secret: () => 'secret',
    run,
  });
  assert.equal((await handler(request())).status, 401);
  assert.equal((await handler(request('wrong'))).status, 401);
});

void test('owners run in turn; one failure neither stops nor hides the others', async () => {
  let clock = 0;
  const ran: string[] = [];
  const errors: string[] = [];
  const handler = createConvexShadowCronHandler({
    owners: () => ['a', 'b', 'c', 'd'],
    secret: () => 'secret',
    now: () => clock,
    budgetMs: 100,
    run: async (userId, deadline) => {
      assert.equal(deadline, 100);
      ran.push(userId);
      if (userId === 'b') throw new Error('boom');
      if (userId === 'c') clock = 150;
      return { userId };
    },
    onError: (_error, userId) => errors.push(userId),
  });
  const response = await handler(request('secret'));
  assert.equal(response.status, 500);
  const { results } = (await response.json()) as {
    results: Record<string, unknown>;
  };
  assert.deepEqual(ran, ['a', 'b', 'c']);
  assert.deepEqual(errors, ['b']);
  assert.deepEqual(results, {
    a: { userId: 'a' },
    b: { error: 'Shadow write failed' },
    c: { userId: 'c' },
    d: { skipped: 'time budget exhausted' },
  });
});

void test('shared work runs once after the owners, within the same budget', async () => {
  let clock = 0;
  const order: string[] = [];
  const errors: unknown[] = [];
  const make = (shared: () => Promise<unknown>, slow = false) =>
    createConvexShadowCronHandler({
      owners: () => ['a', 'b'],
      secret: () => 'secret',
      now: () => clock,
      budgetMs: 100,
      run: async (userId) => {
        order.push(userId);
        if (slow) clock = 150;
        return { userId };
      },
      shared: {
        name: 'catalogue',
        run: async (userId, deadline) => {
          order.push(`shared:${userId}:${deadline}`);
          return shared();
        },
        onError: (error) => errors.push(error),
      },
    });

  const ok = await make(async () => ({ imported: 3 }))(request('secret'));
  assert.equal(ok.status, 200);
  assert.deepEqual(order, ['a', 'b', 'shared:a:100']);
  assert.deepEqual(((await ok.json()) as { catalogue: unknown }).catalogue, {
    imported: 3,
  });

  // A failure fails the job without hiding the owners' results.
  order.length = 0;
  const failing = await make(async () => {
    throw new Error('boom');
  })(request('secret'));
  assert.equal(failing.status, 500);
  const body = (await failing.json()) as {
    results: Record<string, unknown>;
    catalogue: unknown;
  };
  assert.deepEqual(Object.keys(body.results), ['a', 'b']);
  assert.deepEqual(body.catalogue, { error: 'Failed' });
  assert.equal(errors.length, 1);

  // No budget left: the shared work waits for the next run.
  order.length = 0;
  const late = await make(
    async () => assert.fail('must not run'),
    true,
  )(request('secret'));
  assert.equal(late.status, 200);
  assert.deepEqual(order, ['a']);
});

void test('with a shared budget every owner gets a turn, and unused time moves on', async () => {
  let clock = 0;
  const deadlines: Record<string, number> = {};
  const handler = createConvexShadowCronHandler({
    owners: () => ['a', 'b', 'c', 'd'],
    secret: () => 'secret',
    now: () => clock,
    budgetMs: 40_000,
    fair: true,
    run: async (userId, deadline) => {
      deadlines[userId] = deadline;
      // `a` has nothing to do; `b` and `c` use their whole share.
      if (userId !== 'a') clock = deadline;
      return { userId };
    },
  });
  const response = await handler(request('secret'));
  assert.equal(response.status, 200);
  // A quarter each to start with; what `a` left is shared by the other three.
  assert.deepEqual(deadlines, {
    a: 10_000,
    b: 40_000 / 3,
    c: 40_000 / 3 + (40_000 - 40_000 / 3) / 2,
    d: 40_000,
  });

  // Many owners: each still gets a slice worth starting, and the ones the
  // budget does not reach are reported, not dropped.
  clock = 0;
  const many = Array.from({ length: 20 }, (_, index) => `owner-${index}`);
  const ran: string[] = [];
  const crowded = createConvexShadowCronHandler({
    owners: () => many,
    secret: () => 'secret',
    now: () => clock,
    budgetMs: 40_000,
    fair: true,
    run: async (userId, deadline) => {
      ran.push(userId);
      clock = deadline;
      return {};
    },
  });
  const body = (await (await crowded(request('secret'))).json()) as {
    results: Record<string, { skipped?: string }>;
  };
  assert(ran.length >= 8 && ran.length < many.length);
  assert.equal(
    Object.values(body.results).filter((result) => result.skipped).length,
    many.length - ran.length,
  );
});

void test('a run starts the next one only while a copy is unfinished and moving', () => {
  const copying = { mode: 'full', activities: 128, complete: false };
  const current = { mode: 'incremental', activities: 0, complete: true };
  const waiting = { skipped: 'time budget exhausted' };
  const moved = { skipped: 'Convex writes for this owner' };
  const run = (results: Record<string, unknown>, chained = 0) =>
    shouldContinue({ results }, chained);

  assert.equal(run({ a: copying }), true);
  assert.equal(run({ a: current, b: copying, c: waiting }), true);
  // Everything copied: the schedule is enough.
  assert.equal(run({ a: current, b: moved }), false);
  assert.equal(run({ a: { ...current, activities: 3 }, b: moved }), false);
  // Unfinished, but nobody got anywhere: do not spin.
  assert.equal(run({ a: { ...copying, activities: 0 }, b: waiting }), false);
  assert.equal(run({ a: { error: 'Shadow write failed' }, b: waiting }), false);
  // One scheduled trigger chains only until the next one is due.
  assert.equal(run({ a: copying }, MAX_CHAINED_RUNS - 1), true);
  assert.equal(run({ a: copying }, MAX_CHAINED_RUNS), false);
  assert.equal(shouldContinue(null, 0), false);
  assert.equal(shouldContinue({}, 0), false);
});
