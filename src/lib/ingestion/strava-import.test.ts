import assert from 'node:assert/strict';

import test from 'node:test';

import { stravaImportDTOSchema } from '~/contracts/v1/strava-import';

import { stravaImportMessage } from './strava-import';

const run = (changes: Record<string, unknown> = {}) =>
  stravaImportDTOSchema.parse({
    available: true,
    runId: 'fixture',
    status: 'running',
    reason: null,
    startedAt: null,
    finishedAt: null,
    retryAt: null,
    summaries: 1,
    details: 0,
    photos: 2,
    ...changes,
  });

void test('manual import keeps complete recovery meaning and independently formatted counts', () => {
  assert.equal(stravaImportMessage(run({ status: 'idle' })), null);
  assert.equal(
    stravaImportMessage(run()),
    'Fetching from Strava in the background… Summaries fetched: 1 · Activities updated: 0 · Photos fetched: 2.',
  );
  assert.match(
    stravaImportMessage(run({ summaries: 1000 }), 'de-DE')!,
    /Summaries fetched: 1\.000/,
  );
  assert.match(
    stravaImportMessage(run({ status: 'interrupted' }))!,
    /Saved progress is kept/,
  );
  assert.match(
    stravaImportMessage(run({ status: 'blocked' }))!,
    /Reconnect Strava/,
  );
  assert.match(
    stravaImportMessage(run({ status: 'failed', reason: 'rate_limit' }))!,
    /request limit/,
  );
});
