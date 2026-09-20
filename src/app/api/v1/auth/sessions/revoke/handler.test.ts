import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { createRevokeSessionHandler } from './handler.ts';

const now = new Date('2026-09-20T12:00:00.000Z');

function postRequest(body: unknown) {
  return new Request('https://example.test/api/v1/auth/sessions/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

void test('POST /api/v1/auth/sessions/revoke revokes the named token', async () => {
  let capturedToken: string | undefined;
  const POST = createRevokeSessionHandler({
    now: () => now,
    isAuthenticated: async () => true,
    revokeSessionByToken: async (token) => {
      capturedToken = token;
    },
  });

  const response = await POST(postRequest({ token: 'token-b' }));
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(capturedToken, 'token-b');
  assert.deepEqual(body, {
    schemaVersion: '1',
    serverTime: now.toISOString(),
    data: { status: 'revoked' },
  });
});

void test('POST /api/v1/auth/sessions/revoke returns not_authenticated without a session', async () => {
  const POST = createRevokeSessionHandler({
    now: () => now,
    isAuthenticated: async () => false,
    revokeSessionByToken: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await POST(postRequest({ token: 'token-b' }));
  const body: unknown = await response.json();

  assert.equal(response.status, 401);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('POST /api/v1/auth/sessions/revoke rejects a malformed body', async () => {
  const POST = createRevokeSessionHandler({
    now: () => now,
    isAuthenticated: async () => true,
    revokeSessionByToken: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await POST(postRequest({}));
  const body: unknown = await response.json();

  assert.equal(response.status, 400);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});
