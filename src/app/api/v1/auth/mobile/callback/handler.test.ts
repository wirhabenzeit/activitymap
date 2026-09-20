import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { parseMobileRedirectAllowlist } from '~/server/auth/mobile-redirect-allowlist.ts';
import { createMobileAuthCallbackHandler } from './handler.ts';

const ALLOWLIST = parseMobileRedirectAllowlist('activitymap://auth/callback');

const CALLBACK_URL =
  'https://app.example.test/api/v1/auth/mobile/callback?state=s1&code_challenge=c1&redirect_uri=activitymap%3A%2F%2Fauth%2Fcallback';

void test('GET /api/v1/auth/mobile/callback redirects to the universal link with a code and the original state', async () => {
  let capturedIssueInput: unknown;
  const GET = createMobileAuthCallbackHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSessionUserId: async () => 'user-1',
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async (input) => {
      capturedIssueInput = input;
      return { code: 'one-time-code' };
    },
  });

  const response = await GET(
    new Request(CALLBACK_URL, { headers: { cookie: 'irrelevant=1' } }),
  );

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.protocol, 'activitymap:');
  assert.equal(location.searchParams.get('code'), 'one-time-code');
  assert.equal(location.searchParams.get('state'), 's1');
  assert.deepEqual(capturedIssueInput, {
    userId: 'user-1',
    state: 's1',
    pkceChallenge: 'c1',
    redirectUri: 'activitymap://auth/callback',
    sessionBearerToken: 'signed-session-token.sig',
  });
});

void test('GET /api/v1/auth/mobile/callback returns not_authenticated without a session', async () => {
  const GET = createMobileAuthCallbackHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSessionUserId: async () => null,
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await GET(new Request(CALLBACK_URL));
  const body: unknown = await response.json();

  assert.equal(response.status, 401);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('GET /api/v1/auth/mobile/callback rejects a redirect_uri outside the allow-list without issuing a code', async () => {
  let issueCalled = false;
  const GET = createMobileAuthCallbackHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSessionUserId: async () => 'user-1',
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async () => {
      issueCalled = true;
      return { code: 'one-time-code' };
    },
  });

  const response = await GET(
    new Request(
      'https://app.example.test/api/v1/auth/mobile/callback?state=s1&code_challenge=c1&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback',
    ),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 400);
  assert.equal(issueCalled, false);
  assert.equal(
    (body as { error: { code: string } }).error.code,
    'redirect_not_allowed',
  );
});

void test('GET /api/v1/auth/mobile/callback fails closed when the session cookie is missing despite a resolved session', async () => {
  let capturedError: unknown;
  const GET = createMobileAuthCallbackHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    onError: (error) => {
      capturedError = error;
    },
    resolveSessionUserId: async () => 'user-1',
    extractSessionBearerToken: () => null,
    issueLoginCode: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await GET(new Request(CALLBACK_URL));

  assert.equal(response.status, 500);
  assert.ok(capturedError instanceof Error);
});
