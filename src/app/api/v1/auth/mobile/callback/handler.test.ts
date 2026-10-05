import assert from 'node:assert/strict';
import test from 'node:test';

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

void test('GET /api/v1/auth/mobile/callback returns to the app with not_authenticated without a session', async () => {
  const GET = createMobileAuthCallbackHandler({
    createRequestId: () => 'req-1',
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSessionUserId: async () => null,
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await GET(new Request(CALLBACK_URL));

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.protocol, 'activitymap:');
  assert.equal(location.searchParams.get('error'), 'not_authenticated');
  assert.equal(location.searchParams.get('state'), 's1');
  assert.equal(location.searchParams.get('request_id'), 'req-1');
  assert.equal(location.searchParams.get('code'), null);
});

void test('GET /api/v1/auth/mobile/callback hands a declined authorization back to the app', async () => {
  let resolved = false;
  const GET = createMobileAuthCallbackHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSessionUserId: async () => {
      resolved = true;
      return 'user-1';
    },
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await GET(
    new Request(`${CALLBACK_URL}&error=access_denied&error_description=x`),
  );

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.searchParams.get('error'), 'access_denied');
  assert.equal(location.searchParams.get('state'), 's1');
  assert.equal(location.searchParams.get('error_description'), null);
  assert.equal(location.searchParams.get('code'), null);
  // An existing browser session must not turn a declined attempt into a login.
  assert.equal(resolved, false);
});

void test('GET /api/v1/auth/mobile/callback does not forward arbitrary error text', async () => {
  const GET = createMobileAuthCallbackHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSessionUserId: async () => 'user-1',
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async () => ({ code: 'one-time-code' }),
  });

  const response = await GET(
    new Request(`${CALLBACK_URL}&error=${encodeURIComponent('<b>nope</b>')}`),
  );

  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.searchParams.get('error'), 'sign_in_failed');
});

void test('GET /api/v1/auth/mobile/callback does not redirect a provider error outside the allow-list', async () => {
  const GET = createMobileAuthCallbackHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSessionUserId: async () => 'user-1',
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async () => ({ code: 'one-time-code' }),
  });

  const response = await GET(
    new Request(
      'https://app.example.test/api/v1/auth/mobile/callback?state=s1&code_challenge=c1&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback&error=access_denied',
    ),
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
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

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.searchParams.get('error'), 'server_error');
  assert.equal(location.searchParams.get('code'), null);
  assert.ok(capturedError instanceof Error);
});
