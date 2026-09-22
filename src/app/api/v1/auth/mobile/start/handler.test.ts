import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { parseMobileRedirectAllowlist } from '~/server/auth/mobile-redirect-allowlist.ts';
import { buildMobileCallbackUrl, createMobileAuthStartHandler } from './handler.ts';

const ALLOWLIST = parseMobileRedirectAllowlist(
  'activitymap://auth/callback',
);

void test('buildMobileCallbackUrl round-trips state/PKCE challenge/redirect URI', () => {
  const url = buildMobileCallbackUrl('https://app.example.test/api/v1/auth/mobile/start', {
    state: 'the-state',
    codeChallenge: 'the-challenge',
    redirectUri: 'activitymap://auth/callback',
  });

  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/api/v1/auth/mobile/callback');
  assert.equal(parsed.searchParams.get('state'), 'the-state');
  assert.equal(parsed.searchParams.get('code_challenge'), 'the-challenge');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'activitymap://auth/callback');
});

void test('GET /api/v1/auth/mobile/start redirects to the Strava authorization URL', async () => {
  let capturedCallbackURL: string | undefined;
  const GET = createMobileAuthStartHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    startSocialSignIn: async ({ callbackURL }) => {
      capturedCallbackURL = callbackURL;
      return { url: 'https://www.strava.com/oauth/authorize?client_id=1' };
    },
  });

  const response = await GET(
    new Request(
      'https://app.example.test/api/v1/auth/mobile/start?state=s1&code_challenge=c1&redirect_uri=activitymap%3A%2F%2Fauth%2Fcallback',
      { redirect: 'manual' },
    ),
  );

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get('location'),
    'https://www.strava.com/oauth/authorize?client_id=1',
  );
  assert.ok(capturedCallbackURL?.includes('/api/v1/auth/mobile/callback'));
  assert.ok(capturedCallbackURL?.includes('state=s1'));
});

void test('GET /api/v1/auth/mobile/start forwards every Set-Cookie header onto the redirect', async () => {
  // Regression test: this handler previously called Response.redirect(url,
  // 302), whose header list the Fetch spec makes immutable, so there was no
  // way to attach a Set-Cookie header even if one had been available - and
  // route.ts additionally called `auth.api.signInSocial` without
  // `asResponse: true`, so it never had one to attach in the first place.
  // Better Auth's own OAuth state-verification cookie was silently dropped
  // as a result, and every real sign-in failed once Strava redirected back
  // with "State not persisted correctly". Neither half of that was visible
  // to a test whose fake `startSocialSignIn` never returned `headers`, which
  // is exactly why this must assert Set-Cookie forwarding specifically,
  // not just the redirect Location.
  const GET = createMobileAuthStartHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    startSocialSignIn: async () => ({
      url: 'https://www.strava.com/oauth/authorize?client_id=1',
      headers: new Headers([
        ['set-cookie', 'better-auth.state=abc123; Path=/; HttpOnly'],
        ['set-cookie', 'better-auth.oauth_state=def456; Path=/; HttpOnly'],
      ]),
    }),
  });

  const response = await GET(
    new Request(
      'https://app.example.test/api/v1/auth/mobile/start?state=s1&code_challenge=c1&redirect_uri=activitymap%3A%2F%2Fauth%2Fcallback',
      { redirect: 'manual' },
    ),
  );

  assert.equal(response.status, 302);
  assert.deepEqual(response.headers.getSetCookie(), [
    'better-auth.state=abc123; Path=/; HttpOnly',
    'better-auth.oauth_state=def456; Path=/; HttpOnly',
  ]);
});

void test('GET /api/v1/auth/mobile/start still redirects when startSocialSignIn returns no headers', async () => {
  const GET = createMobileAuthStartHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    startSocialSignIn: async () => ({
      url: 'https://www.strava.com/oauth/authorize?client_id=1',
    }),
  });

  const response = await GET(
    new Request(
      'https://app.example.test/api/v1/auth/mobile/start?state=s1&code_challenge=c1&redirect_uri=activitymap%3A%2F%2Fauth%2Fcallback',
      { redirect: 'manual' },
    ),
  );

  assert.equal(response.status, 302);
  assert.deepEqual(response.headers.getSetCookie(), []);
});

void test('GET /api/v1/auth/mobile/start rejects a missing parameter', async () => {
  const GET = createMobileAuthStartHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    startSocialSignIn: async () => {
      throw new Error('must not be called');
    },
  });

  const response = await GET(
    new Request('https://app.example.test/api/v1/auth/mobile/start?state=s1'),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 400);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('GET /api/v1/auth/mobile/start rejects a redirect_uri outside the allow-list without starting sign-in', async () => {
  let signInCalled = false;
  const GET = createMobileAuthStartHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    startSocialSignIn: async () => {
      signInCalled = true;
      return { url: 'https://www.strava.com/oauth/authorize' };
    },
  });

  const response = await GET(
    new Request(
      'https://app.example.test/api/v1/auth/mobile/start?state=s1&code_challenge=c1&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback',
    ),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 400);
  assert.equal(signInCalled, false);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
  assert.equal(
    (body as { error: { code: string } }).error.code,
    'redirect_not_allowed',
  );
});

void test('GET /api/v1/auth/mobile/start fails closed when sign-in throws', async () => {
  let capturedError: unknown;
  const GET = createMobileAuthStartHandler({
    loadRedirectAllowlist: () => ALLOWLIST,
    onError: (error) => {
      capturedError = error;
    },
    startSocialSignIn: async () => {
      throw new Error('strava is down');
    },
  });

  const response = await GET(
    new Request(
      'https://app.example.test/api/v1/auth/mobile/start?state=s1&code_challenge=c1&redirect_uri=activitymap%3A%2F%2Fauth%2Fcallback',
    ),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 500);
  assert.ok(capturedError instanceof Error);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});
