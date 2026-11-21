import assert from 'node:assert/strict';

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { bearer } from 'better-auth/plugins';
import test from 'node:test';

import {
  StravaCodeRejectedError,
  StravaUnavailableError,
} from '~/server/strava/authorization-code';

import { createStravaAppSignIn } from './strava-app-session.ts';
import { StravaAppSignInError } from './strava-app-sign-in-error.ts';
import { stravaAppSignIn } from './strava-app-sign-in.ts';
import type { StravaUserInfo } from './strava-profile.ts';

type Row = Record<string, unknown>;

function harness(
  overrides: {
    exchangeCode?: (code: string) => Promise<{
      accessToken: string;
      refreshToken: string;
      accessTokenExpiresAt: Date;
    }>;
    fetchUserInfo?: (token: string) => Promise<StravaUserInfo | null>;
    finishSignIn?: (userId: string, scope: string | null) => Promise<void>;
  } = {},
) {
  const db: Record<string, Row[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const finished: Array<{ userId: string; scope: string | null }> = [];
  let tokenSeq = 0;
  const auth = betterAuth({
    baseURL: 'https://activitymap.test',
    secret: 'test-secret-test-secret-test-secret-0123',
    database: memoryAdapter(db),
    plugins: [
      stravaAppSignIn({
        exchangeCode:
          overrides.exchangeCode ??
          (async (code) => {
            assert.ok(code.startsWith('code-'));
            tokenSeq += 1;
            return {
              accessToken: `access-${tokenSeq}`,
              refreshToken: `refresh-${tokenSeq}`,
              accessTokenExpiresAt: new Date('2026-11-21T16:00:00Z'),
            };
          }),
        fetchUserInfo:
          overrides.fetchUserInfo ??
          (async () => ({
            id: '4242',
            email: '4242@strava.local',
            name: 'Ada Rider',
            image: undefined,
            emailVerified: false,
          })),
        finishSignIn:
          overrides.finishSignIn ??
          (async (userId, scope) => {
            finished.push({ userId, scope });
          }),
      }),
      bearer({ requireSignature: true }),
    ],
  });
  return {
    auth,
    db,
    finished,
    signIn: createStravaAppSignIn(auth),
    headers: () => new Headers({ 'user-agent': 'ActivityMap/1.0 test' }),
  };
}

async function sessionFor(
  auth: ReturnType<typeof harness>['auth'],
  bearerToken: string,
) {
  return auth.api.getSession({
    headers: new Headers({ authorization: `Bearer ${bearerToken}` }),
  });
}

void test('a new athlete gets a user, a Strava account and a working bearer session', async () => {
  const h = harness();
  const { bearerToken } = await h.signIn({
    code: 'code-1',
    scope: 'read,activity:read,activity:read_all',
    headers: h.headers(),
  });

  const session = await sessionFor(h.auth, bearerToken);
  assert.ok(session, 'the signed token must resolve to a session');
  assert.equal(session.user.email, '4242@strava.local');
  assert.equal(session.user.emailVerified, false);
  assert.equal(session.user.name, 'Ada Rider');

  assert.equal(h.db.user!.length, 1);
  assert.equal(h.db.account!.length, 1);
  const account = h.db.account![0]!;
  assert.equal(account.providerId, 'strava');
  assert.equal(account.accountId, '4242');
  assert.equal(account.accessToken, 'access-1');
  assert.equal(account.refreshToken, 'refresh-1');
  assert.equal(account.scope, 'read,activity:read,activity:read_all');

  // The same follow-up the web callback runs: athlete link and granted scope.
  assert.deepEqual(h.finished, [
    { userId: session.user.id, scope: 'read,activity:read,activity:read_all' },
  ]);
});

void test('the session records the app that signed in', async () => {
  const h = harness();
  await h.signIn({ code: 'code-1', headers: h.headers() });
  assert.equal(h.db.session![0]!.userAgent, 'ActivityMap/1.0 test');
});

void test('signing in again as the same athlete reuses the user and refreshes tokens', async () => {
  const h = harness();
  const first = await h.signIn({ code: 'code-1', headers: h.headers() });
  const second = await h.signIn({ code: 'code-2', headers: h.headers() });

  assert.notEqual(first.bearerToken, second.bearerToken);
  assert.equal(h.db.user!.length, 1);
  assert.equal(h.db.account!.length, 1);
  assert.equal(h.db.account![0]!.accessToken, 'access-2');
  assert.equal(h.db.account![0]!.refreshToken, 'refresh-2');
  assert.equal(h.db.session!.length, 2);
  assert.equal(
    (await sessionFor(h.auth, first.bearerToken))?.user.id,
    (await sessionFor(h.auth, second.bearerToken))?.user.id,
  );
});

void test('a missing or unrecognised scope leaves the granted scope unrecorded', async () => {
  const h = harness();
  await h.signIn({ code: 'code-1', headers: h.headers() });
  assert.deepEqual(
    h.finished.map((entry) => entry.scope),
    [null],
  );
  assert.equal(h.db.account![0]!.scope, undefined);
});

void test('a raw session token is not accepted as a bearer credential', async () => {
  const h = harness();
  await h.signIn({ code: 'code-1', headers: h.headers() });
  const raw = String(h.db.session![0]!.token);
  assert.equal(await sessionFor(h.auth, raw), null);
});

void test('the endpoint is not served over HTTP', async () => {
  const h = harness();
  const response = await h.auth.handler(
    new Request('https://activitymap.test/api/auth/strava-app/sign-in', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://activitymap.test',
      },
      body: JSON.stringify({ code: 'code-1' }),
    }),
  );
  assert.equal(response.status, 404);
  assert.equal(h.db.user!.length, 0);
  assert.equal(h.db.session!.length, 0);
});

void test('a code Strava rejects is a 401 and creates nothing', async () => {
  const h = harness({
    exchangeCode: async () => {
      throw new StravaCodeRejectedError();
    },
  });
  await assert.rejects(
    h.signIn({ code: 'code-1', headers: h.headers() }),
    (error: unknown) =>
      error instanceof StravaAppSignInError &&
      error.status === 401 &&
      error.code === 'strava_code_rejected' &&
      !error.retryable,
  );
  assert.equal(h.db.user!.length, 0);
});

void test('Strava being unreachable is a retryable 502', async () => {
  const h = harness({
    exchangeCode: async () => {
      throw new StravaUnavailableError();
    },
  });
  await assert.rejects(
    h.signIn({ code: 'code-1', headers: h.headers() }),
    (error: unknown) =>
      error instanceof StravaAppSignInError &&
      error.status === 502 &&
      error.retryable,
  );
});

void test('an unreadable Strava profile is a retryable 502 and creates nothing', async () => {
  const h = harness({ fetchUserInfo: async () => null });
  await assert.rejects(
    h.signIn({ code: 'code-1', headers: h.headers() }),
    (error: unknown) =>
      error instanceof StravaAppSignInError &&
      error.status === 502 &&
      error.retryable,
  );
  assert.equal(h.db.user!.length, 0);
});

void test('a failed athlete link leaves no session behind', async () => {
  const h = harness({
    finishSignIn: async () => {
      throw new Error('store unavailable');
    },
  });
  await assert.rejects(
    h.signIn({ code: 'code-1', headers: h.headers() }),
    /store unavailable/,
  );
  assert.equal(h.db.session!.length, 0);
});
