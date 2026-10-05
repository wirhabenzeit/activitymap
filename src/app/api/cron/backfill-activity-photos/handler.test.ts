import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoBackfillCronHandler } from './handler';
void test('photo cron enforces production, authorization, and rollout gates before any work', async () => {
  for (const [production, enabled, secret, status] of [
    [false, true, 'secret', 503],
    [true, true, 'wrong', 401],
    [true, false, 'secret', 200],
    [true, true, 'secret', 200],
  ] as const) {
    let calls = 0;
    const handler = createPhotoBackfillCronHandler({
      externalEffectsEnabled: () => true,
      isProduction: () => production,
      isEnabled: () => enabled,
      getCronSecret: () => 'secret',
      onDisabled: async () => undefined,
      onError: () => undefined,
      backfill: async () => {
        calls++;
        return {
          selected: 0,
          fetched: 0,
          failed: 0,
          superseded: 0,
          requests: 0,
          stopReason: 'complete',
        };
      },
    });
    const response = await handler(
      new Request('https://example.test/api/cron/backfill-activity-photos', {
        method: 'POST',
        headers: { 'x-cron-secret': secret },
      }),
    );
    assert.equal(response.status, status);
    assert.equal(calls, production && enabled && secret === 'secret' ? 1 : 0);
  }
});
