import assert from 'node:assert/strict';
import test from 'node:test';

import type { NewScheduledJobLogEntry } from '~/server/repositories/scheduled-job-log';
import {
  describeJobError,
  recordJobLogDisabled,
  summarizeJobResult,
  withJobLog,
} from './job-log.ts';

function fakeWriter(fail = false) {
  const entries: NewScheduledJobLogEntry[] = [];
  return {
    entries,
    writer: {
      async append(entry: NewScheduledJobLogEntry) {
        if (fail) throw new Error('database unavailable');
        entries.push(entry);
      },
    },
  };
}

function steppingClock(...times: number[]) {
  return () => times.shift() ?? 0;
}

void test('a completed run is logged with its duration, stop reason and counters', async () => {
  const { entries, writer } = fakeWriter();
  const run = withJobLog(
    'backfill-activity-streams',
    async (limit: number) => ({
      selected: limit,
      fetched: 4,
      stopReason: 'activity_limit',
      name: 'Morning Run',
    }),
    {
      writer,
      clock: steppingClock(1_000, 3_500),
      stopReason: (result) => result.stopReason,
    },
  );

  const result = await run(5);

  assert.equal(result.fetched, 4);
  assert.deepEqual(entries, [
    {
      job: 'backfill-activity-streams',
      startedAt: new Date(1_000),
      durationMs: 2_500,
      status: 'completed',
      stopReason: 'activity_limit',
      // Strings (such as an activity name) never reach the log.
      summary: { selected: 5, fetched: 4 },
      error: null,
    },
  ]);
});

void test('a failed run is logged with a short error and still rethrows', async () => {
  const { entries, writer } = fakeWriter();
  const run = withJobLog(
    'drain-webhook-inbox',
    async () => {
      throw new Error('connection refused\n    at somewhere (file.ts:1:1)');
    },
    { writer, clock: steppingClock(0, 40) },
  );

  await assert.rejects(run(), /connection refused/);
  assert.equal(entries[0]!.status, 'failed');
  assert.equal(entries[0]!.error, 'Error: connection refused');
  assert.equal(entries[0]!.durationMs, 40);
});

void test('a log write failure never fails the job', async () => {
  const { writer } = fakeWriter(true);
  const run = withJobLog('cleanup-rate-limits', async () => 12, { writer });
  assert.equal(await run(), 12);
});

void test('a disabled job is logged as disabled', async () => {
  const { entries, writer } = fakeWriter();
  await recordJobLogDisabled('backfill-activity-photos', writer);
  assert.equal(entries[0]!.status, 'disabled');
  assert.equal(entries[0]!.job, 'backfill-activity-photos');
});

void test('summaries keep finite numbers and booleans only', () => {
  assert.deepEqual(summarizeJobResult(7), { result: 7 });
  assert.equal(summarizeJobResult(null), null);
  assert.equal(summarizeJobResult(['a']), null);
  assert.deepEqual(
    summarizeJobResult({
      deleted: 3,
      ok: true,
      nan: Number.NaN,
      cutoff: '2026-10-05',
      metrics: { dead: 1 },
    }),
    { deleted: 3, ok: true },
  );
});

void test('error descriptions are single-line and bounded', () => {
  assert.equal(describeJobError('plain'), 'plain');
  const long = describeJobError(new Error('x'.repeat(1_000)));
  assert.ok(long.length <= 300);
  assert.ok(long.endsWith('…'));
});
