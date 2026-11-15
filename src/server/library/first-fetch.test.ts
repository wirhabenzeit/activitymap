import assert from 'node:assert/strict';

import test from 'node:test';

import { ActivityMutationError } from '~/server/application/activities';
import type { ConvexWriter } from '~/server/sync/convex-writer';

import { firstFetch } from './index';

const actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'bearer',
  convexEpoch: 'epoch',
} as const;
type Sweep = {
  phase: string;
  page: number;
  error: string | null;
  dueAt: number;
  running: boolean;
  completedAt: number | null;
};
const scanning: Sweep = {
  phase: 'scanning',
  page: 1,
  error: null,
  dueAt: 0,
  running: false,
  completedAt: null,
};
function fixture(sweep: Sweep | null, count = 0, started = false) {
  let time = 0;
  let waits = 0;
  const writer: ConvexWriter = {
    async write<T>(operation: { kind: string; [key: string]: unknown }) {
      if (operation.kind === 'sweepNow') return started as T;
      assert.equal(operation.kind, 'sweepStatus');
      return sweep as T;
    },
  };
  return {
    deps: {
      writer,
      knownActivityCount: async () => count,
      now: () => time,
      wait: async (ms: number) => {
        time += ms;
        waits++;
      },
    },
    waits: () => waits,
  };
}

void test('a first page that is still importing after the wait is an error, never an empty Strava library', async () => {
  const f = fixture(scanning);
  await assert.rejects(
    firstFetch(actor, f.deps),
    (error) =>
      error instanceof ActivityMutationError &&
      error.status === 503 &&
      error.message.includes('still being imported'),
  );
  assert(f.waits() > 0);
});

void test('missing importer configuration is reported immediately without a false empty success', async () => {
  const f = fixture({
    ...scanning,
    error: 'The provider gateway is not configured',
    dueAt: 60_000,
  });
  await assert.rejects(
    firstFetch(actor, f.deps),
    (error) =>
      error instanceof ActivityMutationError &&
      error.status === 503 &&
      error.message.includes('not configured') &&
      error.retryAfterSeconds === 30,
  );
  assert.equal(f.waits(), 0);
});

void test('zero is returned after the scan finishes, including a completed empty sweep', async () => {
  for (const sweep of [
    { ...scanning, phase: 'confirming' },
    { ...scanning, phase: 'idle', completedAt: 1 },
  ]) {
    assert.equal(await firstFetch(actor, fixture(sweep).deps), 0);
  }
});

void test('an unstarted or missing sweep cannot prove the Strava library is empty', async () => {
  for (const sweep of [{ ...scanning, phase: 'idle' }, null]) {
    await assert.rejects(
      firstFetch(actor, fixture(sweep).deps),
      /still being imported/,
    );
  }
});

void test('already imported summaries are returned while the rest of the library is pending', async () => {
  assert.equal(await firstFetch(actor, fixture(scanning, 75).deps), 75);
  assert.equal(await firstFetch(actor, fixture(scanning, 4600).deps), 200);
});

void test('rate limits and rejected Strava credentials use the existing actionable error response', async () => {
  await assert.rejects(
    firstFetch(
      actor,
      fixture({ ...scanning, error: 'rate_limited', dueAt: 120_000 }).deps,
    ),
    (error) =>
      error instanceof ActivityMutationError &&
      error.status === 429 &&
      error.retryAfterSeconds === 120,
  );
  await assert.rejects(
    firstFetch(
      actor,
      fixture({ ...scanning, error: 'credentials_rejected' }).deps,
    ),
    (error) =>
      error instanceof ActivityMutationError &&
      error.code === 'strava_not_connected' &&
      error.status === 409,
  );
});
