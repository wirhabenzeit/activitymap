import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { createLogoutHandler } from './handler.ts';

const now = new Date('2026-09-20T12:00:00.000Z');

/**
 * A minimal in-memory session store standing in for Better Auth's real
 * one (`session` table + `auth.api.getSession`/`revokeSession`), just
 * enough to exercise the contract this handler depends on: revoking a
 * session token makes it stop resolving. This sandbox has no live
 * Postgres to run the real Better Auth + Drizzle adapter against, so this
 * is a fake, not an integration test against Better Auth itself - Better
 * Auth's own revoke-then-fail-to-resolve behavior is its own tested
 * behavior, not something this PR re-implements.
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
      // eslint-disable-next-line drizzle/enforce-delete-with-where
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
