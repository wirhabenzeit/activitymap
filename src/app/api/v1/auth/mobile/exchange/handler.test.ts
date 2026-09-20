import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import { mobileExchangeResponseDTOSchema } from '~/contracts/v1/mobile-auth.ts';
import { MobileAuthError } from '~/server/auth/mobile.ts';
import { createMobileExchangeHandler } from './handler.ts';

const now = new Date('2026-09-20T12:00:00.000Z');

function postRequest(body: unknown) {
  return new Request('https://example.test/api/v1/auth/mobile/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

void test('POST /api/v1/auth/mobile/exchange returns a schema-valid success envelope', async () => {
  const POST = createMobileExchangeHandler({
    now: () => now,
    exchangeCode: async () => ({
      bearerToken: 'signed-session-token.sig',
      userId: 'user-1',
    }),
    resolveBearerSessionExpiry: async () =>
      new Date('2026-10-20T12:00:00.000Z'),
  });

  const response = await POST(
    postRequest({ code: 'c', pkceVerifier: 'v', state: 's' }),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    responseEnvelope(mobileExchangeResponseDTOSchema).safeParse(body).success,
    true,
  );
  assert.deepEqual(body, {
    schemaVersion: '1',
    serverTime: now.toISOString(),
    data: {
      sessionToken: 'signed-session-token.sig',
      tokenType: 'Bearer',
      sessionExpiresAt: '2026-10-20T12:00:00.000Z',
    },
  });
});

void test('POST /api/v1/auth/mobile/exchange rejects a malformed body', async () => {
  const POST = createMobileExchangeHandler({
    now: () => now,
    exchangeCode: async () => {
      throw new Error('must not be called');
    },
    resolveBearerSessionExpiry: async () => now,
  });

  const response = await POST(postRequest({ code: 'c' }));
  const body: unknown = await response.json();

  assert.equal(response.status, 400);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
  assert.equal(
    (body as { error: { code: string } }).error.code,
    'validation_failed',
  );
});

for (const code of [
  'invalid_code',
  'expired_code',
  'replayed_code',
  'state_mismatch',
  'pkce_mismatch',
] as const) {
  void test(`POST /api/v1/auth/mobile/exchange maps MobileAuthError(${code}) to a 401 error envelope`, async () => {
    const POST = createMobileExchangeHandler({
      now: () => now,
      exchangeCode: async () => {
        throw new MobileAuthError(code, `boom: ${code}`);
      },
      resolveBearerSessionExpiry: async () => now,
    });

    const response = await POST(
      postRequest({ code: 'c', pkceVerifier: 'v', state: 's' }),
    );
    const body: unknown = await response.json();

    assert.equal(response.status, 401);
    assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
    assert.equal((body as { error: { code: string } }).error.code, code);
  });
}

void test('POST /api/v1/auth/mobile/exchange rejects when the underlying session is no longer valid', async () => {
  const POST = createMobileExchangeHandler({
    now: () => now,
    exchangeCode: async () => ({
      bearerToken: 'revoked-token.sig',
      userId: 'user-1',
    }),
    resolveBearerSessionExpiry: async () => null,
  });

  const response = await POST(
    postRequest({ code: 'c', pkceVerifier: 'v', state: 's' }),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 401);
  assert.equal(
    (body as { error: { code: string } }).error.code,
    'not_authenticated',
  );
});

void test('POST /api/v1/auth/mobile/exchange fails closed on an unexpected error', async () => {
  let capturedError: unknown;
  const POST = createMobileExchangeHandler({
    now: () => now,
    onError: (error) => {
      capturedError = error;
    },
    exchangeCode: async () => {
      throw new Error('database is down');
    },
    resolveBearerSessionExpiry: async () => now,
  });

  const response = await POST(
    postRequest({ code: 'c', pkceVerifier: 'v', state: 's' }),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 500);
  assert.ok(capturedError instanceof Error);
  assert.equal(
    (body as { error: { code: string } }).error.code,
    'internal_error',
  );
});
