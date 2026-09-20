import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_RECONCILIATION_BATCH_SIZE } from '~/server/strava/summary-reconciliation.ts';
import { createSummaryReconciliationCronHandler } from './handler.ts';

const SUCCESS = {
  candidates: 1,
  claimed: 1,
  pages: 1,
  summaries: 2,
  confirmedPresent: 0,
  deleted: 0,
  completed: 1,
  partial: 0,
  failed: 0,
};

function request(secret = 'correct', body?: unknown): Request {
  return new Request('https://example.test/api/cron/reconcile-strava-summaries', {
    method: 'POST',
    headers: { 'x-cron-secret': secret, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

void test('summary reconciliation cron fails closed outside Production', async () => {
  let called = false;
  const POST = createSummaryReconciliationCronHandler({
    externalEffectsEnabled: () => false,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    reconcile: async () => {
      called = true;
      return SUCCESS;
    },
  });
  assert.equal((await POST(request())).status, 503);
  assert.equal(called, false);
});

void test('summary reconciliation cron requires the configured secret', async () => {
  const base = {
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    reconcile: async () => SUCCESS,
  };
  assert.equal(
    (
      await createSummaryReconciliationCronHandler({
        ...base,
        getCronSecret: () => undefined,
      })(request())
    ).status,
    500,
  );
  assert.equal(
    (
      await createSummaryReconciliationCronHandler({
        ...base,
        getCronSecret: () => 'correct',
      })(request('wrong'))
    ).status,
    401,
  );
});

void test('summary reconciliation cron uses a bounded default batch', async () => {
  let receivedBatchSize: number | null = null;
  const POST = createSummaryReconciliationCronHandler({
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    reconcile: async ({ batchSize }) => {
      receivedBatchSize = batchSize;
      return SUCCESS;
    },
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(receivedBatchSize, DEFAULT_RECONCILIATION_BATCH_SIZE);
  assert.deepEqual(await response.json(), SUCCESS);
});

void test('summary reconciliation cron rejects an invalid batch', async () => {
  let called = false;
  const POST = createSummaryReconciliationCronHandler({
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    reconcile: async () => {
      called = true;
      return SUCCESS;
    },
  });
  const response = await POST(request('correct', { batchSize: 21 }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

void test('summary reconciliation cron returns failure when a candidate failed', async () => {
  const POST = createSummaryReconciliationCronHandler({
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    reconcile: async () => ({ ...SUCCESS, completed: 0, failed: 1 }),
  });
  const response = await POST(request());
  assert.equal(response.status, 500);
  assert.equal(((await response.json()) as { failed: number }).failed, 1);
});
