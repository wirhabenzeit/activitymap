import assert from 'node:assert/strict';

import test from 'node:test';

import { createPlaceMatchingCronHandler } from './handler';

const result = {
  selected: 0,
  saved: 0,
  failed: 0,
  superseded: 0,
  groups: 0,
  placesLoaded: 0,
  elapsedMs: 0,
  inputBatches: 0,
  commitBatches: 0,
  inputReadMs: 0,
  catalogueLoadMs: 0,
  matchingMs: 0,
  commitMs: 0,
  stopReason: 'complete' as const,
};
const request = (body = '{}', secret = 'secret') =>
  new Request('https://app.test/api/cron/match-activity-places', {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
    body,
  });
void test('matching cron fails closed and bounds scheduled work', async () => {
  let calls = 0;
  const base = {
    enabled: () => true,
    secret: () => 'secret',
    run: async () => {
      calls++;
      return result;
    },
  };
  for (const [override, status] of [
    [{ enabled: () => false }, 503],
    [{ secret: () => undefined }, 500],
    [{ secret: () => 'other' }, 401],
  ] as const) {
    assert.equal(
      (
        await createPlaceMatchingCronHandler({ ...base, ...override })(
          request(),
        )
      ).status,
      status,
    );
  }
  for (const body of [
    '{',
    '{"activityLimit":0}',
    '{"activityLimit":2001}',
    '{"unknown":true}',
  ])
    assert.equal(
      (await createPlaceMatchingCronHandler(base)(request(body))).status,
      400,
    );
  assert.equal(calls, 0);
  assert.equal(
    (await createPlaceMatchingCronHandler(base)(request())).status,
    200,
  );
  assert.equal(calls, 1);
});
