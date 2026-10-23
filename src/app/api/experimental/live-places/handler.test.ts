import assert from 'node:assert/strict';

import test from 'node:test';

import {
  DEFAULT_LIVE_RADII,
  type LivePlaceResponse,
} from '~/contracts/live-places';

import { createLivePlacesHandler } from './handler';

const actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'cookie' as const,
};
const body = { activityIds: ['123'], thresholds: DEFAULT_LIVE_RADII };
const request = (value: unknown = body, origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/experimental/live-places', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(value),
  });
const empty: LivePlaceResponse = {
  userId: actor.userId,
  places: [],
  candidates: [],
  encounters: [],
  activities: [],
  durationMs: 1,
};
const deps = {
  enabled: () => true,
  resolveActor: async () => actor,
  match: async () => empty,
  onError: () => undefined,
};
void test('live preview fails closed outside local development and without authentication', async () => {
  let called = false;
  const match = async () => {
    called = true;
    return empty;
  };
  assert.equal(
    (
      await createLivePlacesHandler({ ...deps, enabled: () => false, match })(
        request(),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await createLivePlacesHandler({
        ...deps,
        resolveActor: async () => null,
        match,
      })(request())
    ).status,
    401,
  );
  assert.equal(
    (
      await createLivePlacesHandler({ ...deps, match })(
        request(body, 'https://unrelated.example'),
      )
    ).status,
    403,
  );
  assert.equal(called, false);
});
void test('preview limits selection, thresholds and caller-controlled fields before matching', async () => {
  let called = false;
  const handler = createLivePlacesHandler({
    ...deps,
    match: async () => {
      called = true;
      return empty;
    },
  });
  for (const invalid of [
    { ...body, activityIds: [] },
    { ...body, activityIds: ['1', '2', '3', '4', '5', '6'] },
    { ...body, activityIds: ['123', '123'] },
    { ...body, actor: { userId: 'other' } },
    { ...body, thresholds: { ...DEFAULT_LIVE_RADII, hutRadiusM: 101 } },
    { ...body, thresholds: { ...DEFAULT_LIVE_RADII, peakRadiusM: 0 } },
  ])
    assert.equal((await handler(request(invalid))).status, 400);
  assert.equal(called, false);
});
void test('preview binds to authenticated actor, does not expose internal failures, and is not HTTP cached', async () => {
  const response = await createLivePlacesHandler({
    ...deps,
    match: async (caller, input) => {
      assert.deepEqual(caller, actor);
      assert.deepEqual(input, body);
      return empty;
    },
  })(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), empty);
  const failed = await createLivePlacesHandler({
    ...deps,
    match: async () => {
      throw new Error('private data');
    },
  })(request());
  assert.equal(failed.status, 500);
  assert(!(await failed.text()).includes('private data'));
});

void test('local preview accepts loopback aliases but rejects other ports and malformed origins', async () => {
  const handler = createLivePlacesHandler(deps);
  assert.equal(
    (await handler(request(body, 'http://127.0.0.1:3000'))).status,
    200,
  );
  assert.equal(
    (await handler(request(body, 'http://localhost:4000'))).status,
    403,
  );
  assert.equal((await handler(request(body, 'null'))).status, 403);
});
