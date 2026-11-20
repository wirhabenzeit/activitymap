import assert from 'node:assert/strict';

import test from 'node:test';

import {
  MOBILE_ATTEMPT_CLOCK_SKEW_MS,
  MOBILE_ATTEMPT_COOKIE,
  MOBILE_ATTEMPT_TTL_MS,
  createMobileAttemptBinding,
  mobileAttemptDigest,
} from './mobile-attempt.ts';

const START = new Date('2026-11-20T12:00:00Z');
const PARAMS = {
  state: 'state-1',
  codeChallenge: 'challenge-1',
  redirectUri: 'https://activitymap.cc/auth/callback',
};
const request = (cookie?: string) =>
  new Request('https://activitymap.cc/api/v1/auth/mobile/callback', {
    headers: cookie ? { cookie } : {},
  });
const pair = (setCookie: string) => setCookie.split(';')[0]!;

function binding(now = START, secret = 'secret-a') {
  return createMobileAttemptBinding({ secret: () => secret, now: () => now });
}
const issued = (secret = 'secret-a') =>
  pair(binding(START, secret).issueCookie(PARAMS, request()));

void test('an attempt verifies when its cookie, parameters and fresh session agree', () => {
  assert.deepEqual(binding().verify(request(issued()), PARAMS, START), {
    ok: true,
  });
});

void test('a session created a moment before the attempt is tolerated, an old one is not', () => {
  const cookie = request(issued());
  const slightlyEarlier = new Date(
    START.getTime() - MOBILE_ATTEMPT_CLOCK_SKEW_MS + 1,
  );
  assert.equal(binding().verify(cookie, PARAMS, slightlyEarlier).ok, true);

  const ambient = new Date(START.getTime() - 24 * 60 * 60 * 1000);
  assert.deepEqual(binding().verify(cookie, PARAMS, ambient), {
    ok: false,
    reason: 'session_predates_attempt',
  });
});

void test('a missing, malformed or forged cookie never verifies', () => {
  const verify = (cookie?: string) =>
    binding().verify(request(cookie), PARAMS, START);
  assert.deepEqual(verify(), { ok: false, reason: 'missing_cookie' });
  assert.deepEqual(verify(`${MOBILE_ATTEMPT_COOKIE}=garbage`), {
    ok: false,
    reason: 'malformed_cookie',
  });
  assert.deepEqual(verify(`${MOBILE_ATTEMPT_COOKIE}=a.b.c`), {
    ok: false,
    reason: 'malformed_cookie',
  });
  // Signed with another secret, or with a tampered payload.
  assert.deepEqual(verify(issued('secret-b')), {
    ok: false,
    reason: 'bad_signature',
  });
  const [, signature] = issued().split('=')[1]!.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({
      d: mobileAttemptDigest(PARAMS),
      iat: START.getTime() + 1,
    }),
  ).toString('base64url');
  assert.deepEqual(
    verify(`${MOBILE_ATTEMPT_COOKIE}=${forgedPayload}.${signature}`),
    { ok: false, reason: 'bad_signature' },
  );
});

void test('each of state, challenge and redirect URI is bound', () => {
  const cookie = request(issued());
  for (const changed of [
    { ...PARAMS, state: 'x' },
    { ...PARAMS, codeChallenge: 'x' },
    { ...PARAMS, redirectUri: 'activitymap://auth/callback' },
  ]) {
    assert.deepEqual(binding().verify(cookie, changed, START), {
      ok: false,
      reason: 'params_mismatch',
    });
  }
});

void test('values cannot run into their neighbours to forge a digest', () => {
  assert.notEqual(
    mobileAttemptDigest({ state: 'a', codeChallenge: 'bc', redirectUri: 'd' }),
    mobileAttemptDigest({ state: 'ab', codeChallenge: 'c', redirectUri: 'd' }),
  );
});

void test('an attempt expires after the time-to-live and is not valid from the future', () => {
  const cookie = request(issued());
  const later = new Date(START.getTime() + MOBILE_ATTEMPT_TTL_MS + 1);
  assert.deepEqual(binding(later).verify(cookie, PARAMS, later), {
    ok: false,
    reason: 'expired',
  });
  const earlier = new Date(START.getTime() - MOBILE_ATTEMPT_CLOCK_SKEW_MS - 1);
  assert.deepEqual(binding(earlier).verify(cookie, PARAMS, START), {
    ok: false,
    reason: 'expired',
  });
});

void test('the cookie is HttpOnly, Lax and path-scoped, and Secure only over https', () => {
  const secure = binding().issueCookie(PARAMS, request());
  assert.match(secure, /HttpOnly/);
  assert.match(secure, /SameSite=Lax/);
  assert.match(secure, /Path=\/api\/v1\/auth\/mobile(;|$)/);
  assert.match(secure, /Secure/);

  const local = binding().issueCookie(
    PARAMS,
    new Request('http://localhost:3000/api/v1/auth/mobile/start'),
  );
  assert.doesNotMatch(local, /Secure/);
  assert.match(binding().clearCookie(request()), /Max-Age=0/);
});

void test('signing fails closed when no secret is configured', () => {
  const unconfigured = createMobileAttemptBinding({
    secret: () => {
      throw new Error('no secret');
    },
  });
  assert.throws(() => unconfigured.issueCookie(PARAMS, request()));
});
