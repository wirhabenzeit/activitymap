import assert from 'node:assert/strict';

import test from 'node:test';

import { COUNT_FIELDS } from '../../../backend/convex/statsShape';
import { previewIngestionStatus } from './status';

const counts = (values: Record<string, number> = {}) => ({
  ...Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0])),
  ...values,
});
const observedAt = new Date('2026-11-12T10:00:00Z');
const page = (overrides: object = {}) =>
  ({
    counts: counts({ total: 10, detailed: 8, neverFetched: 2, runnable: 3 }),
    oldest: '2020-01-01T00:00:00.000Z',
    newest: '2026-11-10T00:00:00.000Z',
    retryAt: null,
    next: null,
    active: false,
    lastSummaryReconciledAt: null,
    ...overrides,
  }) as never;

void test('a copy that Postgres writes has no jobs of its own', async () => {
  const status = await previewIngestionStatus(async () => page(), observedAt);
  assert.deepEqual(
    [
      status.history.scheduling,
      status.details.scheduling,
      status.streams.scheduling,
      status.history.reconciliation.phase,
      status.history.reconciliation.freshness,
    ],
    [
      'not_scheduled',
      'not_scheduled',
      'not_scheduled',
      'idle',
      'never_completed',
    ],
  );
});

void test('for an account Convex writes, the status shows its jobs and its sweep', async () => {
  const completedAt = Date.parse('2026-11-11T10:00:00Z');
  const dueAt = Date.parse('2026-11-17T10:00:00Z');
  const idle = await previewIngestionStatus(
    async () =>
      page({
        active: true,
        lastSummaryReconciledAt: completedAt,
        sweep: {
          phase: 'idle',
          page: 1,
          scanStartedAt: null,
          dueAt,
          error: null,
        },
      }),
    observedAt,
  );
  assert.deepEqual(
    [
      idle.history.progress,
      idle.history.scheduling,
      idle.history.reconciliation.freshness,
      idle.history.reconciliation.lastCompletedAt,
      idle.history.reconciliation.nextDueAt,
      // What is missing is fetched by the sweep without anyone asking.
      idle.details.scheduling,
      idle.streams.scheduling,
    ],
    [
      'complete',
      'scheduled',
      'current',
      '2026-11-11T10:00:00.000Z',
      '2026-11-17T10:00:00.000Z',
      'scheduled',
      'scheduled',
    ],
  );

  const scanning = await previewIngestionStatus(
    async () =>
      page({
        active: true,
        sweep: {
          phase: 'scanning',
          page: 5,
          scanStartedAt: Date.parse('2026-11-12T09:59:00Z'),
          dueAt,
          error: 'rate_limited',
        },
      }),
    observedAt,
  );
  assert.deepEqual(
    [
      scanning.history.reconciliation.phase,
      scanning.history.reconciliation.pagesScanned,
      scanning.history.reconciliation.scanStartedAt,
      scanning.history.scheduling,
      scanning.history.schedulingReason,
      scanning.history.retryAt,
    ],
    [
      'scanning',
      4,
      '2026-11-12T09:59:00.000Z',
      'waiting',
      'rate_limited',
      '2026-11-17T10:00:00.000Z',
    ],
  );

  // Nothing outstanding is idle, whoever writes.
  const done = await previewIngestionStatus(
    async () =>
      page({
        active: true,
        counts: counts({
          total: 10,
          detailed: 10,
          withData: 9,
          withoutData: 1,
        }),
      }),
    observedAt,
  );
  assert.deepEqual(
    [done.details.scheduling, done.photos.scheduling, done.streams.scheduling],
    ['idle', 'idle', 'idle'],
  );
});
