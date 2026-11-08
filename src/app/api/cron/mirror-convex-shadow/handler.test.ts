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
