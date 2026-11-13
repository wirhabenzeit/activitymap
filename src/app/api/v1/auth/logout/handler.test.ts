import assert from 'node:assert/strict';

import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';

import { createLogoutHandler } from './handler.ts';

const now = new Date('2026-09-20T12:00:00.000Z');

/** Minimal session-store double for the logout contract: revoking a token
 * makes it stop resolving. Backend tests cover the real Convex sign-in store.
 */
function createFakeSessionStore() {
  const activeTokens = new Map<string, { userId: string }>();

  return {
    activeTokens,
    /** Mirrors `~/server/auth/actor.ts`'s `resolveActor`, minus the athlete lookup. */
    resolveActorLike: (headers: Headers): { userId: string } | null => {
      const authHeader = headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) return null;
      const token = authHeader.slice('Bearer '.length);
      return activeTokens.get(token) ?? null;
    },
    resolveCurrentSessionToken: async (headers: Headers) => {
      const authHeader = headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) return null;
      const token = authHeader.slice('Bearer '.length);
      return activeTokens.has(token) ? token : null;
    },
    // This is a plain in-memory `Map`, not a Drizzle query builder.
    revokeSessionByToken: async (token: string) => {
      activeTokens.delete(token);
    },
  };
}

void test('POST /api/v1/auth/logout revokes the current session, and it no longer resolves to an actor', async () => {
  const store = createFakeSessionStore();
  store.activeTokens.set('session-token.sig', { userId: 'user-1' });
  const headers = { authorization: 'Bearer session-token.sig' };

  assert.deepEqual(store.resolveActorLike(new Headers(headers)), {
    userId: 'user-1',
  });

  const POST = createLogoutHandler({
    now: () => now,
    resolveCurrentSessionToken: store.resolveCurrentSessionToken,
    revokeSessionByToken: store.revokeSessionByToken,
  });

  const response = await POST(
    new Request('https://example.test/api/v1/auth/logout', {
      method: 'POST',
      headers,
    }),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    schemaVersion: '1',
    serverTime: now.toISOString(),
    data: { status: 'revoked' },
  });

  // The acceptance criterion this proves: a revoked session's bearer
  // token no longer resolves to an Actor.
  assert.equal(store.resolveActorLike(new Headers(headers)), null);
});

void test('POST /api/v1/auth/logout returns not_authenticated without a session', async () => {
  const POST = createLogoutHandler({
    now: () => now,
    resolveCurrentSessionToken: async () => null,
    revokeSessionByToken: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await POST(
    new Request('https://example.test/api/v1/auth/logout', { method: 'POST' }),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 401);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('POST /api/v1/auth/logout fails closed on an unexpected error', async () => {
  let capturedError: unknown;
  const POST = createLogoutHandler({
    now: () => now,
    onError: (error) => {
      capturedError = error;
    },
    resolveCurrentSessionToken: async () => 'session-token.sig',
    revokeSessionByToken: async () => {
      throw new Error('database is down');
    },
  });

  const response = await POST(
    new Request('https://example.test/api/v1/auth/logout', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token.sig' },
    }),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 500);
  assert.ok(capturedError instanceof Error);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});
