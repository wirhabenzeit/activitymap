import assert from 'node:assert/strict';

import test from 'node:test';

import { createConvexShadowCronHandler, shadowOwners } from './handler';

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
