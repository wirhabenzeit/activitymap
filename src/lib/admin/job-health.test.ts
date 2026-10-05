import assert from 'node:assert/strict';
import test from 'node:test';

import { jobHealth, type JobRun } from './job-health.ts';

const now = new Date('2026-10-05T22:00:00Z');
const minutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000);
const byJob = (runs: JobRun[]) =>
  Object.fromEntries(jobHealth(runs, now).map((row) => [row.job, row]));

void test('a job that ran recently and succeeded is ok', () => {
  const rows = byJob([
    {
      job: 'drain-webhook-inbox',
      startedAt: minutesAgo(4),
      status: 'completed',
    },
  ]);
  assert.equal(rows['drain-webhook-inbox']!.health, 'ok');
});

void test('a job is late after two and a half missed intervals', () => {
  const rows = byJob([
    {
      job: 'drain-webhook-inbox',
      startedAt: minutesAgo(13),
      status: 'completed',
    },
    {
      job: 'backfill-activity-streams',
      startedAt: minutesAgo(140),
      status: 'completed',
    },
    {
      job: 'cleanup-rate-limits',
      startedAt: minutesAgo(160),
      status: 'completed',
    },
  ]);
  assert.equal(rows['drain-webhook-inbox']!.health, 'late');
  assert.equal(rows['backfill-activity-streams']!.health, 'ok');
  assert.equal(rows['cleanup-rate-limits']!.health, 'late');
});

void test('the latest run decides failing and disabled, and failures are counted', () => {
  const rows = byJob([
    {
      job: 'erase-revoked-athletes',
      startedAt: minutesAgo(5),
      status: 'failed',
    },
    {
      job: 'erase-revoked-athletes',
      startedAt: minutesAgo(65),
      status: 'completed',
    },
    {
      job: 'erase-revoked-athletes',
      startedAt: minutesAgo(125),
      status: 'failed',
    },
    {
      job: 'backfill-activity-photos',
      startedAt: minutesAgo(5),
      status: 'disabled',
    },
  ]);
  const erase = rows['erase-revoked-athletes']!;
  assert.equal(erase.health, 'failing');
  assert.equal(erase.failures, 2);
  assert.equal(
    erase.lastSuccess?.startedAt.getTime(),
    minutesAgo(65).getTime(),
  );
  assert.equal(rows['backfill-activity-photos']!.health, 'disabled');
});

void test('jobs without runs are flagged unless they have no schedule', () => {
  const rows = byJob([]);
  assert.equal(rows['reconcile-strava-summaries']!.health, 'no_runs');
  assert.equal(rows['sync-activities']!.health, 'unscheduled');
});
