import assert from 'node:assert/strict';
import test from 'node:test';

import type { JobFinish } from '~/server/repositories/ingestion';
import { recordJobDisabled, withJobHeartbeat } from './job-heartbeat.ts';

function fakeRepository(failWrites = false) {
  const events: string[] = [];
  return {
    events,
    repository: {
      async startJob(job: string) {
        events.push(`start:${job}`);
        if (failWrites) throw new Error('database unavailable');
      },
      async finishJob(job: string, finish: JobFinish) {
        events.push(`finish:${job}:${finish.status}:${finish.stopReason ?? '-'}`);
        if (failWrites) throw new Error('database unavailable');
      },
    },
  };
}

void test('a completed run records its start and its own stop reason', async () => {
  const { events, repository } = fakeRepository();
  const run = withJobHeartbeat(
    'backfill-activity-streams',
    async (limit: number) => ({ stopReason: limit > 1 ? 'request_limit' : 'complete' }),
    (result) => result.stopReason,
    repository,
  );
  assert.deepEqual(await run(2), { stopReason: 'request_limit' });
  assert.deepEqual(events, [
    'start:backfill-activity-streams',
    'finish:backfill-activity-streams:completed:request_limit',
  ]);
});

void test('a thrown run is recorded as failed and still rethrows', async () => {
  const { events, repository } = fakeRepository();
  const run = withJobHeartbeat(
    'sync-activities',
    async () => {
      throw new Error('boom');
    },
    () => null,
    repository,
  );
  await assert.rejects(run(), /boom/);
  assert.deepEqual(events, [
    'start:sync-activities',
    'finish:sync-activities:failed:error',
  ]);
});

void test('heartbeat storage failures never fail the job itself', async () => {
  const { events, repository } = fakeRepository(true);
  const run = withJobHeartbeat(
    'reconcile-strava-summaries',
    async () => 'done',
    () => null,
    repository,
  );
  assert.equal(await run(), 'done');
  await recordJobDisabled('backfill-activity-streams', repository);
  assert.equal(events.length, 3);
});
