import assert from 'node:assert/strict';

import test from 'node:test';

import type { ActivityPlacesResponse } from '~/contracts/activity-places';
import {
  ActivityPlacesInputChangedError,
  ActivityPlacesUnavailableError,
} from '~/server/application/match-activity-places';
import type { Actor } from '~/server/auth/actor';

import { createActivityPlacesHandler } from './handler';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'cookie',
};
const result: ActivityPlacesResponse = {
  userId: actor.userId,
  activityId: '9007199254740993',
  status: 'complete',
  streamGeneration: 'g',
  streamRevision: '2',
  catalogueSnapshotId: 'snapshot',
  matcherVersion: 'matcher',
  places: [],
};
const request = () =>
  new Request('https://activitymap.cc/api/activities/9007199254740993/places');
void test('place reads require authentication, validate IDs losslessly and returns private scoped results', async () => {
  let calls = 0;
  const read = async (current: Actor, id: string) => {
    calls++;
    assert.equal(current, actor);
    assert.equal(id, result.activityId);
    return result;
  };
  const missing = await createActivityPlacesHandler({
    resolveActor: async () => null,
    read,
  })(request(), result.activityId);
  assert.equal(missing.status, 401);
  assert.equal(calls, 0);
  const handle = createActivityPlacesHandler({
    resolveActor: async () => actor,
    read,
  });
  assert.equal((await handle(request(), '1e3')).status, 400);
  assert.equal(calls, 0);
  const response = await handle(request(), result.activityId);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('vary')!, /Cookie.*Authorization/);
});
void test('ownership loss and concurrent input replacement cannot expose a stale successful result', async () => {
  for (const [error, status] of [
    [new ActivityPlacesUnavailableError(), 404],
    [new ActivityPlacesInputChangedError(), 409],
  ] as const) {
    const response = await createActivityPlacesHandler({
      resolveActor: async () => actor,
      read: async () => {
        throw error;
      },
    })(request(), result.activityId);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  let errors = 0;
  for (const bad of [
    { ...result, userId: 'other' },
    { ...result, activityId: '2' },
  ]) {
    const response = await createActivityPlacesHandler({
      resolveActor: async () => actor,
      read: async () => bad,
      onError: () => errors++,
    })(request(), result.activityId);
    assert.equal(response.status, 503);
    assert(!JSON.stringify(await response.json()).includes('other'));
  }
  assert.equal(errors, 2);
});
