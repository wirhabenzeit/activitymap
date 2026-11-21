import assert from 'node:assert/strict';
import test from 'node:test';

import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { mobileExchangeResponseDTOSchema } from '~/contracts/v1/mobile-auth.ts';
import { MobileAuthError } from '~/server/auth/mobile.ts';
import { StravaAppSignInError } from '~/server/auth/strava-app-sign-in-error.ts';

import { createStravaAppCompleteHandler } from './handler.ts';

const now = new Date('2026-11-21T10:00:00.000Z');
const STATE = 'client-generated-state-0123456789';
const body = {
  code: 'strava-code',
  scope: 'read,activity:read_all',
  state: STATE,
  pkceVerifier: 'verifier',
};

function post(payload: unknown) {
  return new Request(
    'https://example.test/api/v1/auth/mobile/strava/complete',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'ActivityMap/1.0',
      },
      body: JSON.stringify(payload),
    },
  );
}

function handler(
  overrides: Partial<Parameters<typeof createStravaAppCompleteHandler>[0]> = {},
) {
  const calls: string[] = [];
  const POST = createStravaAppCompleteHandler({
    now: () => now,
    consumeAttempt: async (input) => {
      calls.push(`consume:${input.state}:${input.pkceVerifier}`);
    },
    signIn: async (input) => {
      calls.push(
        `signIn:${input.code}:${input.scope}:${input.headers.get('user-agent')}`,
      );
      return { bearerToken: 'signed-session-token.sig' };
    },
    resolveBearerSessionExpiry: async () =>
      new Date('2026-12-21T10:00:00.000Z'),
    ...overrides,
  });
  return { POST, calls };
}

void test('consumes the attempt, then signs in, and returns the session', async () => {
  const { POST, calls } = handler();
  const response = await POST(post(body));
  const json: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    responseEnvelope(mobileExchangeResponseDTOSchema).safeParse(json).success,
    true,
  );
  assert.deepEqual((json as { data: unknown }).data, {
    sessionToken: 'signed-session-token.sig',
    tokenType: 'Bearer',
    sessionExpiresAt: '2026-12-21T10:00:00.000Z',
  });
  assert.deepEqual(calls, [
    `consume:${STATE}:verifier`,
    'signIn:strava-code:read,activity:read_all:ActivityMap/1.0',
  ]);
});

void test('the scope is optional', async () => {
  const { POST } = handler();
  const withoutScope: Omit<typeof body, 'scope'> & { scope?: string } = {
    ...body,
  };
  delete withoutScope.scope;
  assert.equal((await POST(post(withoutScope))).status, 200);
});

void test('a failed attempt check never reaches Strava', async () => {
  for (const code of [
    'invalid_code',
    'expired_code',
    'replayed_code',
    'pkce_mismatch',
  ] as const) {
    let signedIn = false;
    const { POST } = handler({
      consumeAttempt: async () => {
        throw new MobileAuthError(code, 'no');
      },
      signIn: async () => {
        signedIn = true;
        return { bearerToken: 'x' };
      },
    });
    const response = await POST(post(body));
    assert.equal(response.status, 401);
    assert.equal(
      errorEnvelopeSchema.parse(await response.json()).error.code,
      code,
    );
    assert.equal(signedIn, false);
  }
});

void test('a code Strava rejects is a 401', async () => {
  const { POST } = handler({
    signIn: async () => {
      throw new StravaAppSignInError(
        'strava_code_rejected',
        401,
        false,
        'rejected',
      );
    },
  });
  const response = await POST(post(body));
  const parsed = errorEnvelopeSchema.parse(await response.json());
  assert.equal(response.status, 401);
  assert.equal(parsed.error.code, 'strava_code_rejected');
  assert.equal(parsed.error.retryable, false);
});

void test('Strava being unavailable is a retryable 502', async () => {
  const { POST } = handler({
    signIn: async () => {
      throw new StravaAppSignInError('upstream_unavailable', 502, true, 'down');
    },
  });
  const response = await POST(post(body));
  assert.equal(response.status, 502);
  assert.equal(
    errorEnvelopeSchema.parse(await response.json()).error.retryable,
    true,
  );
});

void test('a session that does not resolve is not handed out', async () => {
  const { POST } = handler({ resolveBearerSessionExpiry: async () => null });
  const response = await POST(post(body));
  assert.equal(response.status, 401);
  assert.equal(
    errorEnvelopeSchema.parse(await response.json()).error.code,
    'not_authenticated',
  );
});

void test('invalid bodies are rejected before anything runs', async () => {
  const { POST, calls } = handler();
  for (const payload of [
    {},
    { ...body, state: 'short' },
    { ...body, code: '' },
    { ...body, pkceVerifier: '' },
  ]) {
    assert.equal((await POST(post(payload))).status, 400);
  }
  assert.equal(calls.length, 0);
});

void test('an unexpected failure is a reported, retryable 500 without details', async () => {
  const reported: unknown[] = [];
  const { POST } = handler({
    signIn: async () => {
      throw new Error('secret internals');
    },
    onError: (error) => reported.push(error),
  });
  const response = await POST(post(body));
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.ok(!text.includes('secret internals'));
  assert.equal(reported.length, 1);
});
