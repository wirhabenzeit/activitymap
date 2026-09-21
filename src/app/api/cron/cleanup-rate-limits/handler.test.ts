import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCleanupRateLimitsCronHandler,
  DEFAULT_RATE_LIMIT_BUCKET_RETENTION_MS,
} from './handler.ts';

function request(secret = 'correct'): Request {
  return new Request('https://example.test/api/cron/cleanup-rate-limits', {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
  });
}

void test('cleanup-rate-limits cron fails closed outside Production without deleting anything', async () => {
  let called = false;
  const POST = createCleanupRateLimitsCronHandler({
    externalEffectsEnabled: () => false,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    deleteWindowsBefore: async () => {
      called = true;
      return 0;
    },
  });

  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

void test('cleanup-rate-limits cron requires a configured matching secret', async () => {
  const base = {
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    deleteWindowsBefore: async () => 0,
  };

  const missing = createCleanupRateLimitsCronHandler({
    ...base,
    getCronSecret: () => undefined,
  });
  assert.equal((await missing(request())).status, 500);

  const wrong = createCleanupRateLimitsCronHandler({
    ...base,
    getCronSecret: () => 'correct',
  });
  assert.equal((await wrong(request('wrong'))).status, 401);
});

void test('cleanup-rate-limits cron deletes windows older than the retention cutoff and reports it', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const captured: { cutoff: Date | null } = { cutoff: null };
  const POST = createCleanupRateLimitsCronHandler({
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    now: () => now,
    deleteWindowsBefore: async (cutoff) => {
      captured.cutoff = cutoff;
      return 42;
    },
  });

  const response = await POST(request());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { deleted: number; cutoff: string };
  assert.equal(body.deleted, 42);
  const expectedCutoff = new Date(
    now.getTime() - DEFAULT_RATE_LIMIT_BUCKET_RETENTION_MS,
  );
  assert.equal(captured.cutoff?.getTime(), expectedCutoff.getTime());
  assert.equal(body.cutoff, expectedCutoff.toISOString());
});

void test('cleanup-rate-limits cron reports failure without leaking the raw error', async () => {
  const POST = createCleanupRateLimitsCronHandler({
    externalEffectsEnabled: () => true,
    externalEffectsDisabledMessage: 'disabled',
    getCronSecret: () => 'correct',
    deleteWindowsBefore: async () => {
      throw new Error('db unavailable');
    },
  });

  const response = await POST(request());
  assert.equal(response.status, 500);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, 'Failed to clean up rate-limit buckets');
});
