import assert from 'node:assert/strict';
import test from 'node:test';
import { createStravaImportHandler } from './handler';
import type { StravaImportDTO } from '~/contracts/v1/strava-import';
import type { ImportClaim } from '~/server/repositories/strava-import';
import { StravaImportError } from '~/server/application/strava-import';
const claim: ImportClaim = {
  actor: { userId: 'owner', athleteId: 42, authentication: 'cookie' },
  accountId: 'account',
  runId: 'run',
  cursor: null,
};
const status: StravaImportDTO = {
  available: true,
  runId: 'run',
  status: 'running',
  reason: null,
  startedAt: '2026-10-17T10:00:00.000Z',
  finishedAt: null,
  retryAt: '2026-10-17T10:05:00.000Z',
  summaries: 0,
  details: 0,
  photos: 0,
};
function setup() {
  const queued: (() => Promise<void>)[] = [],
    errors: unknown[] = [];
  let started = 0,
    ran = 0;
  const deps = {
    resolveActor: async () => claim.actor as typeof claim.actor | null,
    read: async () => status,
    start: async () => {
      started++;
      return { claim: claim as ImportClaim | null, status };
    },
    run: async (resolved: ImportClaim, timeMs: number) => {
      assert.deepEqual(resolved, claim);
      assert.ok(timeMs <= 35_000);
      ran++;
    },
    afterResponse: (work: () => Promise<void>) => {
      queued.push(work);
    },
    onError: (error: unknown) => {
      errors.push(error);
    },
  };
  return { deps, queued, errors, starts: () => started, runs: () => ran };
}
const request = (origin?: string) =>
  new Request('https://example.test/api/v1/strava-import', {
    method: 'POST',
    ...(origin ? { headers: { Origin: origin } } : {}),
  });
void test('POST persists a run and returns 202 before dispatch; GET never starts work', async () => {
  const f = setup();
  const response = await createStravaImportHandler(f.deps, 'POST')(request());
  assert.equal(response.status, 202);
  assert.equal(f.runs(), 0);
  assert.equal(f.queued.length, 1);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  await f.queued[0]!();
  assert.equal(f.runs(), 1);
  assert.equal(
    (await createStravaImportHandler(f.deps, 'GET')(request())).status,
    200,
  );
  assert.equal(f.starts(), 1);
});
void test('running/cooldown requests reuse the durable status without another dispatch', async () => {
  const f = setup();
  f.deps.start = async () => ({ claim: null, status });
  assert.equal(
    (await createStravaImportHandler(f.deps, 'POST')(request())).status,
    200,
  );
  assert.equal(f.queued.length, 0);
});
void test('authentication, origin and disconnected accounts prevent dispatch', async () => {
  const f = setup();
  assert.equal(
    (
      await createStravaImportHandler(
        f.deps,
        'POST',
      )(request('https://other.test'))
    ).status,
    403,
  );
  assert.equal(f.starts(), 0);
  f.deps.resolveActor = async () => null;
  assert.equal(
    (await createStravaImportHandler(f.deps, 'POST')(request())).status,
    401,
  );
  f.deps.resolveActor = async () => claim.actor;
  f.deps.start = async () => {
    throw new StravaImportError(
      409,
      'strava_not_connected',
      'Reconnect Strava.',
    );
  };
  assert.equal(
    (await createStravaImportHandler(f.deps, 'POST')(request())).status,
    409,
  );
  assert.equal(f.queued.length, 0);
});
void test('background failures do not reject the response', async () => {
  const f = setup();
  f.deps.run = async () => {
    throw new Error('worker failed');
  };
  assert.equal(
    (await createStravaImportHandler(f.deps, 'POST')(request())).status,
    202,
  );
  await f.queued[0]!();
  assert.equal(f.errors.length, 1);
});
