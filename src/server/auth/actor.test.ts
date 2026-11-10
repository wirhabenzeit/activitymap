import assert from 'node:assert/strict';

import test from 'node:test';

import { UserNotFoundError } from '~/server/db/internal.ts';

import { UnauthenticatedError, requireActor, resolveActor } from './actor.ts';

function headersWith(entries: Record<string, string> = {}): Headers {
  return new Headers(entries);
}

void test('resolveActor rejects a request with no session at all', async () => {
  const actor = await resolveActor(headersWith(), {
    getSession: async () => null,
    getUser: async () => {
      throw new Error('must not be called when there is no session');
    },
  });
  assert.equal(actor, null);
});

void test('resolveActor rejects an expired or revoked session (Better Auth resolves both to no session)', async () => {
  // Better Auth's `getSession` itself returns null/undefined for an expired
  // or revoked session - there is no separate "expired" shape to check for.
  // This proves resolveActor treats that exactly like no session at all.
  const actor = await resolveActor(
    headersWith({ authorization: 'Bearer expired-token' }),
    {
      getSession: async () => undefined,
      getUser: async () => {
        throw new Error('must not be called for an expired/revoked session');
      },
    },
  );
  assert.equal(actor, null);
});

void test('resolveActor rejects a session with no local user row (deleted account)', async () => {
  const actor = await resolveActor(headersWith(), {
    getSession: async () => ({ user: { id: 'user-1' } }),
    getUser: async () => {
      throw new UserNotFoundError();
    },
  });
  assert.equal(actor, null);
});

void test('resolveActor propagates a database failure instead of misclassifying it as unauthenticated', async () => {
  await assert.rejects(
    resolveActor(headersWith(), {
      getSession: async () => ({ user: { id: 'user-1' } }),
      getUser: async () => {
        throw new Error('connection refused');
      },
    }),
    /connection refused/,
  );
});

void test('resolveActor rejects a session with no linked Strava athlete', async () => {
  const actor = await resolveActor(headersWith(), {
    getSession: async () => ({ user: { id: 'user-1' } }),
    getUser: async () => ({ athlete_id: null }),
  });
  assert.equal(actor, null);
});

void test('resolveActor returns a bearer Actor for a valid Authorization header', async () => {
  const actor = await resolveActor(
    headersWith({ authorization: 'Bearer valid-token' }),
    {
      getSession: async () => ({ user: { id: 'user-1' } }),
      getUser: async () => ({ athlete_id: 42 }),
    },
  );
  assert.deepEqual(actor, {
    userId: 'user-1',
    athleteId: 42,
    authentication: 'bearer',
  });
});

void test('resolveActor returns a cookie Actor when there is no Authorization header', async () => {
  const actor = await resolveActor(headersWith(), {
    getSession: async () => ({ user: { id: 'user-1' } }),
    getUser: async () => ({ athlete_id: 42 }),
  });
  assert.deepEqual(actor, {
    userId: 'user-1',
    athleteId: 42,
    authentication: 'cookie',
  });
});

void test('requireActor throws UnauthenticatedError for an expired/revoked session instead of returning null', async () => {
  await assert.rejects(
    requireActor(headersWith(), { getSession: async () => null }),
    UnauthenticatedError,
  );
});

void test('requireActor resolves the Actor for a valid session', async () => {
  const actor = await requireActor(headersWith(), {
    getSession: async () => ({ user: { id: 'user-1' } }),
    getUser: async () => ({ athlete_id: 42 }),
  });
  assert.equal(actor.userId, 'user-1');
});

void test('resolveActor says when Convex writes the account, and under which epoch it is read', async () => {
  const resolve = (user: Record<string, unknown>) =>
    resolveActor(headersWith(), {
      getSession: async () => ({ user: { id: 'user-1' } }),
      getUser: async () => ({ athlete_id: 42, ...user }),
    });
  const base = { userId: 'user-1', athleteId: 42, authentication: 'cookie' };
  // Being copied: the epoch is recorded, and Postgres still serves.
  assert.deepEqual(
    await resolve({ writer: 'postgres', convexEpoch: 'epoch-0123456789ab' }),
    base,
  );
  assert.deepEqual(
    await resolve({ writer: 'handoff', convexEpoch: 'epoch-0123456789ab' }),
    base,
  );
  assert.deepEqual(
    await resolve({ writer: 'convex', convexEpoch: 'epoch-0123456789ab' }),
    { ...base, convexWrites: true, convexEpoch: 'epoch-0123456789ab' },
  );
  // Moved before epochs were recorded.
  assert.deepEqual(await resolve({ writer: 'convex', convexEpoch: null }), {
    ...base,
    convexWrites: true,
  });
});
