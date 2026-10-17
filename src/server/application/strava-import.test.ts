import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runStravaImport,
  startStravaImport,
  StravaImportError,
} from './strava-import';
import type {
  ImportClaim,
  StravaImportRepository,
} from '~/server/repositories/strava-import';
import type { ActivityImportProgress } from '~/server/strava/activity-import-policy';
const claim: ImportClaim = {
  actor: { userId: 'owner', athleteId: 42, authentication: 'cookie' },
  accountId: 'account',
  runId: 'run',
  cursor: { before: 1_700_000_000, page: 4, done: false },
};
function setup() {
  const saved: {
    progress: ActivityImportProgress;
    finish: Parameters<StravaImportRepository['save']>[2];
  }[] = [];
  const repository: StravaImportRepository = {
    read: async () => {
      throw new Error('unused');
    },
    start: async () => null,
    isCurrent: async () => true,
    candidates: async () => [],
    replaceCredentials: async () => true,
    save: async (_claim, progress, finish) => {
      saved.push({ progress, finish });
    },
  };
  return { repository, saved, rateLimits: { incrementAndGet: async () => 1 } };
}
void test('manual worker checkpoints progress and records shared quota retry deadlines', async () => {
  const f = setup();
  await runStravaImport(claim, {
    ...f,
    clock: () => 0,
    batch: async (_actor, options) => {
      assert.deepEqual(options.cursor, claim.cursor);
      await options.onProgress({
        summaries: 400,
        details: 2,
        photos: 3,
        requests: 8,
        cursor: { ...claim.cursor!, page: 5 },
      });
      options.onRateLimited(86_400);
      return {
        summaries: 400,
        details: 2,
        requests: 9,
        stopReason: 'rate_limit',
      };
    },
  });
  assert.equal(f.saved.length, 2);
  assert.equal(f.saved[1]!.progress.photos, 3);
  assert.equal(f.saved[1]!.finish?.status, 'deferred');
  assert.equal(f.saved[1]!.finish?.retryAt?.getTime(), 86_400_000);
});
void test('global load and superseded leases avoid all Strava work', async () => {
  const f = setup();
  let calls = 0;
  const batch = async () => {
    calls++;
    throw new Error('must not fetch');
  };
  await runStravaImport(claim, {
    ...f,
    batch,
    rateLimits: { incrementAndGet: async () => 2 },
  });
  assert.equal(f.saved[0]?.finish?.reason, 'busy');
  f.repository.isCurrent = async () => false;
  await runStravaImport(claim, { ...f, batch });
  assert.equal(calls, 0);
});
void test('failed runs retain their last checkpoint and disconnected/disabled starts reject', async () => {
  const f = setup();
  await assert.rejects(
    runStravaImport(claim, {
      ...f,
      batch: async (_actor, options) => {
        await options.onProgress({
          summaries: 200,
          details: 0,
          photos: 0,
          requests: 1,
          cursor: claim.cursor,
        });
        throw new Error('worker failed');
      },
    }),
  );
  assert.equal(f.saved.at(-1)?.progress.summaries, 200);
  assert.equal(f.saved.at(-1)?.finish?.status, 'failed');
  await assert.rejects(
    startStravaImport(claim.actor, f.repository, true),
    (error: unknown) =>
      error instanceof StravaImportError && error.status === 409,
  );
  await assert.rejects(
    startStravaImport(claim.actor, f.repository, false),
    (error: unknown) =>
      error instanceof StravaImportError && error.status === 403,
  );
});
