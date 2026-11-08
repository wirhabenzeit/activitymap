import assert from 'node:assert/strict';

import test from 'node:test';

import {
  DEFAULT_PLACE_DEBUG_SETTINGS,
  type PlaceDebugResponse,
} from '~/contracts/place-debug';
import {
  ActivityPlacesInputChangedError,
  ActivityPlacesUnavailableError,
} from '~/server/application/match-activity-places';
import type { Actor } from '~/server/auth/actor';

import { createPlaceDebugHandler } from './handler';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'cookie',
};
const result: PlaceDebugResponse = {
  userId: 'owner',
  activityId: '9007199254740993',
  status: 'complete',
  streamGeneration: 'g',
  streamRevision: '1',
  catalogueSnapshotId: 'snapshot',
  matcherVersion: 'v4',
  settings: DEFAULT_PLACE_DEBUG_SETTINGS,
  reasons: [],
  candidates: [],
};
const request = (value: unknown = DEFAULT_PLACE_DEBUG_SETTINGS) =>
  new Request('https://example.test/api/activities/1/places/debug', {
    method: 'POST',
    body: JSON.stringify(value),
  });
void test('debug access uses the existing admin allowlist directly', async () => {
  const previousAdminAllowlist = process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS;
  let calls = 0;
  const handle = createPlaceDebugHandler({
    resolveActor: async () => actor,
    debug: async () => {
      calls++;
      return result;
    },
  });
  try {
    delete process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS;
    assert.deepEqual(await (await handle(request())).json(), {
      userId: 'owner',
      allowed: false,
    });
    assert.equal((await handle(request(), result.activityId)).status, 404);
    process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS = '42';
    assert.deepEqual(await (await handle(request())).json(), {
      userId: 'owner',
      allowed: true,
    });
    assert.equal((await handle(request(), result.activityId)).status, 200);
    process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS = '43';
    assert.deepEqual(await (await handle(request())).json(), {
      userId: 'owner',
      allowed: false,
    });
    assert.equal((await handle(request(), result.activityId)).status, 404);
    assert.equal(calls, 1);
  } finally {
    if (previousAdminAllowlist === undefined)
      delete process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS;
    else process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS = previousAdminAllowlist;
  }
});
void test('capability and debug requests enforce access before matching and return private responses', async () => {
  let calls = 0;
  const debug = async () => {
    calls++;
    return result;
  };
  const unauth = createPlaceDebugHandler({
    resolveActor: async () => null,
    debug,
  });
  assert.equal((await unauth(request(), result.activityId)).status, 401);
  const denied = createPlaceDebugHandler({
    resolveActor: async () => actor,
    debug,
    allowed: () => false,
  });
  assert.equal((await denied(request(), result.activityId)).status, 404);
  const capability = await denied(request());
  assert.deepEqual(await capability.json(), {
    userId: 'owner',
    allowed: false,
  });
  assert.equal(calls, 0);
  const handle = createPlaceDebugHandler({
    resolveActor: async () => actor,
    debug,
    allowed: () => true,
  });
  assert.equal((await handle(request(), '1e3')).status, 400);
  assert.equal(
    (
      await handle(
        request({ ...DEFAULT_PLACE_DEBUG_SETTINGS, peakRadiusM: 2001 }),
        '1',
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handle(
        request({ ...DEFAULT_PLACE_DEBUG_SETTINGS, maxComparisons: 999999 }),
        '1',
      )
    ).status,
    400,
  );
  const response = await handle(request(), result.activityId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), result);
  assert.equal(calls, 1);
});
void test('ownership, stale inputs and cross-account responses fail closed', async () => {
  for (const [error, status] of [
    [new ActivityPlacesUnavailableError(), 404],
    [new ActivityPlacesInputChangedError(), 409],
  ] as const) {
    const handle = createPlaceDebugHandler({
      resolveActor: async () => actor,
      allowed: () => true,
      debug: async () => {
        throw error;
      },
    });
    assert.equal((await handle(request(), result.activityId)).status, status);
  }
  const handle = createPlaceDebugHandler({
    resolveActor: async () => actor,
    allowed: () => true,
    debug: async () => ({ ...result, userId: 'other' }),
  });
  assert.equal((await handle(request(), result.activityId)).status, 503);
});
