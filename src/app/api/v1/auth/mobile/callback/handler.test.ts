import assert from 'node:assert/strict';

import test from 'node:test';

import { createMobileAttemptBinding } from '~/server/auth/mobile-attempt.ts';
import { parseMobileRedirectAllowlist } from '~/server/auth/mobile-redirect-allowlist.ts';

import { createMobileAuthCallbackHandler } from './handler.ts';

const ALLOWLIST = parseMobileRedirectAllowlist('activitymap://auth/callback');

const NOW = new Date('2026-11-20T12:00:00Z');
const attempts = createMobileAttemptBinding({
  secret: () => 'test-secret',
  now: () => NOW,
});
const PARAMS = {
  state: 's1',
  codeChallenge: 'c1',
  redirectUri: 'activitymap://auth/callback',
};
/** The `name=value` pair `/mobile/start` would have set for these params. */
const attemptCookie = (params = PARAMS) =>
  attempts
    .issueCookie(params, new Request('https://app.example.test/'))
    .split(';')[0]!;
/** A session created by the attempt itself, as Better Auth does at the OAuth callback. */
const freshSession = async () => ({ userId: 'user-1', createdAt: NOW });

const CALLBACK_URL =
  'https://app.example.test/api/v1/auth/mobile/callback?state=s1&code_challenge=c1&redirect_uri=activitymap%3A%2F%2Fauth%2Fcallback';

void test('GET /api/v1/auth/mobile/callback redirects to the universal link with a code and the original state', async () => {
  let capturedIssueInput: unknown;
  const GET = createMobileAuthCallbackHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSession: freshSession,
    attempts,
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async (input) => {
      capturedIssueInput = input;
      return { code: 'one-time-code' };
    },
  });

  const response = await GET(
    new Request(CALLBACK_URL, { headers: { cookie: attemptCookie() } }),
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
    resolveSession: async () => null,
    attempts,
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
    resolveSession: async () => {
      resolved = true;
      return { userId: 'user-1', createdAt: NOW };
    },
    attempts,
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
    resolveSession: freshSession,
    attempts,
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
    resolveSession: freshSession,
    attempts,
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
    resolveSession: freshSession,
    attempts,
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
    resolveSession: freshSession,
    attempts,
    extractSessionBearerToken: () => null,
    issueLoginCode: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await GET(
    new Request(CALLBACK_URL, { headers: { cookie: attemptCookie() } }),
  );

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.searchParams.get('error'), 'server_error');
  assert.equal(location.searchParams.get('code'), null);
  assert.ok(capturedError instanceof Error);
});

function guardedHandler(
  overrides: { createdAt?: Date; onIssue?: () => void } = {},
) {
  return createMobileAuthCallbackHandler({
    createRequestId: () => 'req-1',
    loadRedirectAllowlist: () => ALLOWLIST,
    resolveSession: async () => ({
      userId: 'user-1',
      createdAt: overrides.createdAt ?? NOW,
    }),
    attempts,
    extractSessionBearerToken: () => 'signed-session-token.sig',
    issueLoginCode: async () => {
      overrides.onIssue?.();
      return { code: 'one-time-code' };
    },
  });
}

void test('GET /api/v1/auth/mobile/callback issues no code without the attempt cookie from /mobile/start (#482)', async () => {
  let issued = false;
  const GET = guardedHandler({ onIssue: () => (issued = true) });

  // The crafted-URL case: an ambient session cookie, but no attempt.
  const response = await GET(
    new Request(CALLBACK_URL, {
      headers: { cookie: 'better-auth.session_token=x' },
    }),
  );

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.searchParams.get('error'), 'invalid_attempt');
  assert.equal(location.searchParams.get('state'), 's1');
  assert.equal(location.searchParams.get('code'), null);
  assert.equal(issued, false);
});

void test('GET /api/v1/auth/mobile/callback does not hand out a session that predates the attempt (#482)', async () => {
  let issued = false;
  const GET = guardedHandler({
    // The victim's long-lived browser session, not one this attempt created.
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    onIssue: () => (issued = true),
  });

  const response = await GET(
    new Request(CALLBACK_URL, { headers: { cookie: attemptCookie() } }),
  );

  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.searchParams.get('error'), 'invalid_attempt');
  assert.equal(issued, false);
});

void test('GET /api/v1/auth/mobile/callback rejects an attempt cookie issued for different parameters (#482)', async () => {
  let issued = false;
  const GET = guardedHandler({ onIssue: () => (issued = true) });

  for (const other of [
    { ...PARAMS, state: 'other-state' },
    { ...PARAMS, codeChallenge: 'attacker-challenge' },
    { ...PARAMS, redirectUri: 'activitymap://auth/callback/other' },
  ]) {
    const response = await GET(
      new Request(CALLBACK_URL, { headers: { cookie: attemptCookie(other) } }),
    );
    const location = new URL(response.headers.get('location') ?? '');
    assert.equal(location.searchParams.get('error'), 'invalid_attempt');
  }
  assert.equal(issued, false);
});

void test('GET /api/v1/auth/mobile/callback ends the attempt: the cookie is cleared on success and on failure', async () => {
  const GET = guardedHandler();

  const ok = await GET(
    new Request(CALLBACK_URL, { headers: { cookie: attemptCookie() } }),
  );
  assert.equal(
    new URL(ok.headers.get('location') ?? '').searchParams.get('code'),
    'one-time-code',
  );
  assert.match(
    ok.headers.get('set-cookie') ?? '',
    /^activitymap_mobile_attempt=; .*Max-Age=0/,
  );

  const rejected = await GET(new Request(CALLBACK_URL));
  assert.match(rejected.headers.get('set-cookie') ?? '', /Max-Age=0/);
});
