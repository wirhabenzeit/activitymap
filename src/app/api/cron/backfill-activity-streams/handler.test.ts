import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreamBackfillCronHandler } from './handler';

const result = {
  selected: 0,
  fetched: 0,
  unavailable: 0,
  retried: 0,
  failed: 0,
  requests: 0,
  remainingBacklog: 0,
  stopReason: 'complete' as const,
  elapsedMs: 0,
};
const request = (body?: string, secret = 'secret') =>
  new Request('https://app.test/api/cron/backfill-activity-streams', {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
    body,
  });
const base = {
  externalEffectsEnabled: () => true,
  isProduction: () => true,
  isEnabled: () => true,
  getCronSecret: () => 'secret',
  backfill: async () => result,
};
void test('backfill cron fails closed for preview, disabled effects, missing/wrong secret and rollout switch', async () => {
  for (const [override, status] of [
    [{ isProduction: () => false }, 503],
    [{ externalEffectsEnabled: () => false }, 503],
    [{ getCronSecret: () => undefined }, 500],
    [{ getCronSecret: () => 'other' }, 401],
    [{ isEnabled: () => false }, 200],
  ] as const) {
    let calls = 0;
    const handler = createStreamBackfillCronHandler({
      ...base,
      ...override,
      backfill: async () => {
        calls++;
        return result;
      },
    });
    assert.equal((await handler(request())).status, status);
    assert.equal(calls, 0);
  }
});
void test('backfill cron validates caps, refuses malformed JSON, defaults to 5 activities/10 requests', async () => {
  let received: unknown;
  const handler = createStreamBackfillCronHandler({
    ...base,
    backfill: async (options) => {
      received = options;
      return result;
    },
  });
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(received, { activityLimit: 5, requestLimit: 10 });
  for (const body of [
    '{',
    'null',
    '[]',
    '{"activityLimit":11}',
    '{"requestLimit":21}',
    '{"activityLimit":0}',
    '{"activityLimit":1.5}',
    '{"force":true}',
  ])
    assert.equal((await handler(request(body))).status, 400, body);
  const response = await handler(
    request('{"activityLimit":2,"requestLimit":3}'),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(received, { activityLimit: 2, requestLimit: 3 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
void test('backfill cron reports safe failure without upstream payloads', async () => {
  const handler = createStreamBackfillCronHandler({
    ...base,
    backfill: async () => {
      throw new Error('synthetic-secret');
    },
  });
  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /synthetic-secret/);
});
