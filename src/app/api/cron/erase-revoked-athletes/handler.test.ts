import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ERASURE_BATCH_SIZE } from '~/server/strava/erasure.ts';
import { createErasureCronHandler } from './handler.ts';

const SUCCESS = {
  candidates: 1,
  erased: 1,
  cancelled: 0,
  stale: 0,
  failed: 0,
};

function request(secret = 'correct', body?: unknown): Request {
  return new Request('https://example.test/api/cron/erase-revoked-athletes', {
    method: 'POST',
    headers: { 'x-cron-secret': secret, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

void test('erasure cron fails closed outside Production without running deletion', async () => {
  let called = false;
  const POST = createErasureCronHandler({
    externalEffectsEnabled: () => false,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    eraseDue: async () => {
      called = true;
      return SUCCESS;
    },
  });

  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

void test('erasure cron requires a configured matching secret', async () => {
  const base = {
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    eraseDue: async () => SUCCESS,
  };

  const missing = createErasureCronHandler({
    ...base,
    getCronSecret: () => undefined,
  });
  assert.equal((await missing(request())).status, 500);

  const wrong = createErasureCronHandler({
    ...base,
    getCronSecret: () => 'correct',
  });
  assert.equal((await wrong(request('wrong'))).status, 401);
});

void test('erasure cron uses the bounded default batch and returns safe aggregate counts', async () => {
  let receivedBatchSize: number | null = null;
  const POST = createErasureCronHandler({
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    eraseDue: async ({ batchSize }) => {
      receivedBatchSize = batchSize;
      return SUCCESS;
    },
  });

  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(receivedBatchSize, DEFAULT_ERASURE_BATCH_SIZE);
  assert.deepEqual(await response.json(), SUCCESS);
});

void test('erasure cron rejects an invalid batch size before running deletion', async () => {
  let called = false;
  const POST = createErasureCronHandler({
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    eraseDue: async () => {
      called = true;
      return SUCCESS;
    },
  });

  const response = await POST(request('correct', { batchSize: 101 }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

void test('erasure cron returns failure when any candidate transaction failed', async () => {
  const POST = createErasureCronHandler({
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    eraseDue: async () => ({ ...SUCCESS, erased: 0, failed: 1 }),
  });

  const response = await POST(request('correct', { batchSize: 10 }));
  assert.equal(response.status, 500);
  const body = (await response.json()) as { failed: number };
  assert.equal(body.failed, 1);
});
