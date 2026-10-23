import assert from 'node:assert/strict';

import test from 'node:test';

import type { Actor } from '~/server/auth/actor';

import { createVisitedPlacesHandler } from './handler';

const actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'cookie' as const,
};

void test('places handler is unavailable outside the local experiment before any places read', async () => {
  const result = await createVisitedPlacesHandler({
    enabled: () => false,
    resolveActor: async () => {
      throw new Error('Should not resolve');
    },
    load: async () => {
      throw new Error('Should not read');
    },
    onError: () => assert.fail('Unexpected error'),
  })();
  assert.equal(result.status, 404);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
});

void test('places endpoint rejects anonymous reads and binds authenticated reads to the caller', async () => {
  let called = false;
  const deps = {
    enabled: () => true,
    resolveActor: async () => null,
    load: async (caller: Actor) => {
      called = true;
      assert.deepEqual(caller, actor);
      return [];
    },
    onError: () => assert.fail('Unexpected error'),
  };
  assert.equal((await createVisitedPlacesHandler(deps)()).status, 401);
  assert.equal(called, false);
  const result = await createVisitedPlacesHandler({
    ...deps,
    resolveActor: async () => actor,
  })();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { userId: 'owner', places: [] });
  assert.equal(result.headers.get('vary'), 'Cookie, Authorization');
});

void test('places endpoint hides database errors', async () => {
  const error = new Error('Sensitive database detail');
  const result = await createVisitedPlacesHandler({
    enabled: () => true,
    resolveActor: async () => actor,
    load: async () => {
      throw error;
    },
    onError: (value) => assert.equal(value, error),
  })();
  assert.equal(result.status, 500);
  assert(!JSON.stringify(await result.json()).includes(error.message));
});
