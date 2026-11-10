import assert from 'node:assert/strict';

import test from 'node:test';

import type { ParityReport } from '~/server/convex-mirror/parity';

import { createConvexParityCronHandler } from './handler';

const request = (secret?: string) =>
  new Request('https://app.test/api/cron/convex-shadow-parity', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });

const report = (fields: Partial<ParityReport> = {}): ParityReport => ({
  status: 'ok',
  copy: 'complete',
  checkpoint: 10,
  sampled: 3,
  inFlight: 0,
  compared: { activities: 3, summaries: 3, photos: 0 },
  expectedDifferences: {},
  differences: {},
  ...fields,
});
const mustNotRun = async (): Promise<ParityReport> =>
  assert.fail('must not run');

void test('the parity check stays off until shadow owners are configured', async () => {
  const handler = createConvexParityCronHandler({
    owners: () => null,
    secret: () => 'secret',
    check: mustNotRun,
  });
  assert.equal((await handler(request('secret'))).status, 503);
});

void test('the cron secret is required and checked', async () => {
  const unconfigured = createConvexParityCronHandler({
    owners: () => ['a'],
    secret: () => undefined,
    check: mustNotRun,
  });
  assert.equal((await unconfigured(request('x'))).status, 500);
  const handler = createConvexParityCronHandler({
    owners: () => ['a'],
    secret: () => 'secret',
    check: mustNotRun,
  });
  assert.equal((await handler(request())).status, 401);
  assert.equal((await handler(request('wrong'))).status, 401);
});

void test('parity and an unfinished copy succeed', async () => {
  const handler = createConvexParityCronHandler({
    owners: () => ['a', 'b'],
    secret: () => 'secret',
    check: async (userId) =>
      report(userId === 'b' ? { copy: 'in-progress' } : {}),
  });
  const response = await handler(request('secret'));
  assert.equal(response.status, 200);
  const { results } = (await response.json()) as {
    results: Record<string, ParityReport>;
  };
  assert.equal(results.b!.copy, 'in-progress');
});

void test('drift fails the job; the response omits example values', async () => {
  const reported: string[] = [];
  const handler = createConvexParityCronHandler({
    owners: () => ['a', 'b'],
    secret: () => 'secret',
    check: async (userId) =>
      userId === 'a'
        ? report({
            status: 'drift',
            differences: {
              'activity.name': { count: 2, example: '1: "Run" != "Ride"' },
            },
          })
        : report(),
    onReport: (result, userId) => reported.push(`${userId}:${result.status}`),
  });
  const response = await handler(request('secret'));
  assert.equal(response.status, 500);
  const { results } = (await response.json()) as {
    results: Record<string, { status: string; differences: unknown }>;
  };
  assert.deepEqual(results.a!.differences, { 'activity.name': 2 });
  assert.equal(results.b!.status, 'ok');
  // Examples reach the logs through onReport.
  assert.deepEqual(reported, ['a:drift', 'b:ok']);
});

void test('a failing check fails the job without stopping other owners', async () => {
  const errors: string[] = [];
  const handler = createConvexParityCronHandler({
    owners: () => ['a', 'b'],
    secret: () => 'secret',
    check: async (userId) => {
      if (userId === 'a') throw new Error('bridge down');
      return report();
    },
    onError: (_error, userId) => errors.push(userId),
  });
  const response = await handler(request('secret'));
  assert.equal(response.status, 500);
  const { results } = (await response.json()) as {
    results: Record<string, unknown>;
  };
  assert.deepEqual(results.a, { error: 'Parity check failed' });
  assert.equal((results.b as ParityReport).status, 'ok');
  assert.deepEqual(errors, ['a']);
});
