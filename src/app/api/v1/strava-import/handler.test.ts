import assert from 'node:assert/strict';

import test from 'node:test';

import type { StravaImportDTO } from '~/contracts/v1/strava-import';
import { StravaImportError } from '~/server/application/strava-import';
import type { Actor } from '~/server/auth/actor';

import { createStravaImportHandler } from './handler';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'cookie',
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
  const errors: unknown[] = [];
  let started = 0;
  const deps = {
    resolveActor: async () => actor as Actor | null,
    read: async () => status,
    start: async (): Promise<{ status: StravaImportDTO }> => {
      started++;
      return { status };
    },
    onError: (error: unknown) => {
      errors.push(error);
    },
  };
  return { deps, errors, starts: () => started };
}
const request = (origin?: string) =>
  new Request('https://example.test/api/v1/strava-import', {
    method: 'POST',
    ...(origin ? { headers: { Origin: origin } } : {}),
  });

void test('POST starts the fetch and answers with its status; GET never starts work', async () => {
  const f = setup();
  const response = await createStravaImportHandler(f.deps, 'POST')(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(
    ((await response.json()) as { data: StravaImportDTO }).data.status,
    'running',
  );
  assert.equal(
    (await createStravaImportHandler(f.deps, 'GET')(request())).status,
    200,
  );
  assert.equal(f.starts(), 1);
});

void test('authentication, origin and disconnected accounts prevent a start', async () => {
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
  f.deps.resolveActor = async () => actor;
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
  assert.equal(f.errors.length, 0);
});

void test('an unexpected failure is reported and answered as an internal error', async () => {
  const f = setup();
  f.deps.start = async () => {
    throw new Error('bridge down');
  };
  const response = await createStravaImportHandler(f.deps, 'POST')(request());
  assert.equal(response.status, 500);
  assert.equal(f.errors.length, 1);
});
