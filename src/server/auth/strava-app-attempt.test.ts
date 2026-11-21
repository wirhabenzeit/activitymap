import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NewStravaAppAttempt,
  StravaAppAttempt,
  StravaAppAttemptsRepository,
} from '~/server/repositories/strava-app-attempts';

import { MobileAuthError, computeS256PkceChallenge } from './mobile.ts';
import {
  STRAVA_APP_ATTEMPT_TTL_MS,
  buildStravaAppAuthorizationUrl,
  consumeStravaAppAttempt,
  startStravaAppAttempt,
  stravaAppAuthorizationConfig,
} from './strava-app-attempt.ts';

/** In-memory double with the repository's consume-once contract. */
function fakeRepository(): StravaAppAttemptsRepository & {
  rows: Map<string, StravaAppAttempt>;
} {
  const rows = new Map<string, StravaAppAttempt>();
  let nextId = 1;
  return {
    rows,
    async create(record: NewStravaAppAttempt) {
      const row: StravaAppAttempt = {
        id: `attempt-${nextId++}`,
        ...record,
        createdAt: new Date(),
        consumedAt: null,
      };
      rows.set(row.stateHash, row);
      return row;
    },
    async consumeByStateHash(stateHash, now) {
      const row = rows.get(stateHash);
      if (row?.consumedAt !== null) return null;
      rows.set(stateHash, { ...row, consumedAt: now });
      return { ...row };
    },
    async findByStateHash(stateHash) {
      return rows.get(stateHash) ?? null;
    },
  };
}

const STATE = 'client-generated-state-0123456789';
const VERIFIER = 'a-random-pkce-verifier-string-that-is-long-enough';
const CHALLENGE = computeS256PkceChallenge(VERIFIER);
const T0 = new Date('2026-11-21T10:00:00Z');

void test('an attempt is consumed once with the matching verifier', async () => {
  const repository = fakeRepository();
  const { expiresAt } = await startStravaAppAttempt(
    { state: STATE, pkceChallenge: CHALLENGE },
    { repository, now: () => T0 },
  );
  assert.equal(expiresAt.getTime(), T0.getTime() + STRAVA_APP_ATTEMPT_TTL_MS);

  await consumeStravaAppAttempt(
    { state: STATE, pkceVerifier: VERIFIER },
    { repository, now: () => new Date(T0.getTime() + 60_000) },
  );
});

void test('the state is stored only as a hash', async () => {
  const repository = fakeRepository();
  await startStravaAppAttempt(
    { state: STATE, pkceChallenge: CHALLENGE },
    { repository, now: () => T0 },
  );
  for (const row of repository.rows.values()) {
    assert.ok(!JSON.stringify(row).includes(STATE));
  }
});

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof MobileAuthError);
    return error.code;
  }
  assert.fail('expected a MobileAuthError');
}

void test('a replayed attempt is rejected', async () => {
  const repository = fakeRepository();
  await startStravaAppAttempt(
    { state: STATE, pkceChallenge: CHALLENGE },
    { repository, now: () => T0 },
  );
  const input = { state: STATE, pkceVerifier: VERIFIER };
  await consumeStravaAppAttempt(input, { repository, now: () => T0 });
  assert.equal(
    await failure(
      consumeStravaAppAttempt(input, { repository, now: () => T0 }),
    ),
    'replayed_code',
  );
});

void test('an unknown or foreign state is rejected', async () => {
  const repository = fakeRepository();
  assert.equal(
    await failure(
      consumeStravaAppAttempt(
        { state: 'never-registered-state-0123456789', pkceVerifier: VERIFIER },
        { repository, now: () => T0 },
      ),
    ),
    'invalid_code',
  );
});

void test('an expired attempt is rejected and cannot be retried', async () => {
  const repository = fakeRepository();
  await startStravaAppAttempt(
    { state: STATE, pkceChallenge: CHALLENGE },
    { repository, now: () => T0 },
  );
  const later = () => new Date(T0.getTime() + STRAVA_APP_ATTEMPT_TTL_MS + 1);
  const input = { state: STATE, pkceVerifier: VERIFIER };
  assert.equal(
    await failure(consumeStravaAppAttempt(input, { repository, now: later })),
    'expired_code',
  );
  assert.equal(
    await failure(
      consumeStravaAppAttempt(input, { repository, now: () => T0 }),
    ),
    'replayed_code',
  );
});

void test('a wrong verifier is rejected and burns the attempt', async () => {
  const repository = fakeRepository();
  await startStravaAppAttempt(
    { state: STATE, pkceChallenge: CHALLENGE },
    { repository, now: () => T0 },
  );
  assert.equal(
    await failure(
      consumeStravaAppAttempt(
        { state: STATE, pkceVerifier: 'not-the-verifier' },
        { repository, now: () => T0 },
      ),
    ),
    'pkce_mismatch',
  );
  assert.equal(
    await failure(
      consumeStravaAppAttempt(
        { state: STATE, pkceVerifier: VERIFIER },
        { repository, now: () => T0 },
      ),
    ),
    'replayed_code',
  );
});

void test('the authorization URL is Strava’s installed-app route', () => {
  const url = new URL(
    buildStravaAppAuthorizationUrl(
      { clientId: '1234', redirectUri: 'https://activitymap.cc/auth/strava' },
      { state: STATE, forceConsent: false },
    ),
  );
  assert.equal(
    `${url.protocol}//${url.host}${url.pathname}`,
    'strava://oauth/mobile/authorize',
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: '1234',
    redirect_uri: 'https://activitymap.cc/auth/strava',
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read,activity:read_all,activity:write',
    state: STATE,
  });
});

void test('reconnecting forces Strava’s consent screen', () => {
  const url = new URL(
    buildStravaAppAuthorizationUrl(
      { clientId: '1234', redirectUri: 'https://activitymap.cc/auth/strava' },
      { state: STATE, forceConsent: true },
    ),
  );
  assert.equal(url.searchParams.get('approval_prompt'), 'force');
});

void test('the handoff needs both the Strava client and a redirect', () => {
  assert.equal(stravaAppAuthorizationConfig({}), null);
  assert.equal(stravaAppAuthorizationConfig({ AUTH_STRAVA_ID: '1' }), null);
  assert.equal(
    stravaAppAuthorizationConfig({ STRAVA_APP_REDIRECT_URI: 'https://a.b/c' }),
    null,
  );
  assert.equal(
    stravaAppAuthorizationConfig({
      AUTH_STRAVA_ID: '1',
      STRAVA_APP_REDIRECT_URI: 'not a url',
    }),
    null,
  );
  assert.deepEqual(
    stravaAppAuthorizationConfig({
      AUTH_STRAVA_ID: ' 1 ',
      STRAVA_APP_REDIRECT_URI: 'https://activitymap.cc/auth/strava',
    }),
    { clientId: '1', redirectUri: 'https://activitymap.cc/auth/strava' },
  );
});
