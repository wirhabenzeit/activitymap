import assert from 'node:assert/strict';

import test from 'node:test';

import { importStatusFromSweep } from './convex-import';

const sweep = {
  number: 3,
  phase: 'idle' as const,
  page: 1,
  scanStartedAt: null,
  dueAt: Date.parse('2026-11-17T10:00:00Z'),
  running: false,
  error: null,
  completedAt: Date.parse('2026-11-11T10:00:00Z'),
};

void test('the import status is the reconciliation sweep, in the command’s terms', () => {
  assert.deepEqual(importStatusFromSweep(null, true), {
    available: true,
    runId: null,
    status: 'idle',
    reason: null,
    startedAt: null,
    finishedAt: null,
    retryAt: null,
    summaries: 0,
    details: 0,
    photos: 0,
  });
  const finished = importStatusFromSweep(sweep, true);
  assert.deepEqual(
    [finished.status, finished.reason, finished.finishedAt, finished.runId],
    ['succeeded', 'complete', '2026-11-11T10:00:00.000Z', 'sweep-3'],
  );
  assert.equal(
    importStatusFromSweep({ ...sweep, completedAt: null }, false).available,
    false,
  );

  const scanning = importStatusFromSweep(
    {
      ...sweep,
      phase: 'scanning',
      page: 4,
      scanStartedAt: Date.parse('2026-11-17T10:00:00Z'),
      running: true,
    },
    true,
  );
  assert.deepEqual(
    [scanning.status, scanning.summaries, scanning.startedAt],
    ['running', 300, '2026-11-17T10:00:00.000Z'],
  );
  assert.equal(
    importStatusFromSweep(
      { ...sweep, phase: 'confirming', running: true },
      true,
    ).status,
    'running',
  );
  // Between two confirm batches: neither running nor finished.
  const between = importStatusFromSweep(
    {
      ...sweep,
      phase: 'confirming',
      running: false,
      scanStartedAt: Date.parse('2026-11-17T10:00:00Z'),
      dueAt: Date.parse('2026-11-17T11:00:00Z'),
      completedAt: Date.parse('2026-11-11T10:00:00Z'),
    },
    true,
  );
  assert.deepEqual(
    [between.status, between.reason, between.retryAt, between.finishedAt],
    ['deferred', null, '2026-11-17T11:00:00.000Z', null],
  );

  // Finished within the hour: the next request is not accepted before then.
  const recent = importStatusFromSweep(
    { ...sweep, requestableAt: Date.parse('2026-11-11T11:00:00Z') },
    true,
  );
  assert.deepEqual(
    [recent.status, recent.retryAt],
    ['succeeded', '2026-11-11T11:00:00.000Z'],
  );
  assert.equal(finished.retryAt, null);

  // Waiting between two runs: for the rate limit, or after another failure.
  const limited = importStatusFromSweep(
    { ...sweep, phase: 'scanning', page: 2, error: 'rate_limited' },
    true,
  );
  assert.deepEqual(
    [limited.status, limited.reason, limited.retryAt],
    ['deferred', 'rate_limit', '2026-11-17T10:00:00.000Z'],
  );
  assert.equal(
    importStatusFromSweep(
      { ...sweep, phase: 'scanning', error: 'upstream_error 503' },
      true,
    ).reason,
    'internal_error',
  );
});
