import assert from 'node:assert/strict';
import test from 'node:test';

import type { MobileLoginCode } from '~/server/db/schema';
import type {
  MobileLoginCodesRepository,
  NewMobileLoginCode,
} from '~/server/repositories/mobile-login-codes';

import {
  MobileAuthError,
  computeS256PkceChallenge,
  exchangeMobileLoginCode,
  issueMobileLoginCode,
} from './mobile.ts';

/**
 * An in-memory fake of `MobileLoginCodesRepository`, in the same spirit as
 * the fakes in `~/server/application/activities.test.ts`: this sandbox has
 * no live Postgres, so the replay/expiry/state/PKCE behavior below is
 * proven against a fake that implements the same atomic-consume contract
 * the real Drizzle repository does (see that repository's
 * `consumeByCodeHash` doc comment), not against a real database.
 */
function createFakeRepository(): MobileLoginCodesRepository {
  const rows = new Map<string, MobileLoginCode>();
  let nextId = 1;

  return {
    async create(record: NewMobileLoginCode) {
      const row: MobileLoginCode = {
        id: `code-${nextId++}`,
        codeHash: record.codeHash,
        state: record.state,
        pkceChallenge: record.pkceChallenge,
        redirectUri: record.redirectUri,
        userId: record.userId,
        sessionBearerToken: record.sessionBearerToken,
        createdAt: new Date(),
        expiresAt: record.expiresAt,
        consumedAt: null,
      };
      rows.set(row.codeHash, row);
      return row;
    },

    async consumeByCodeHash(codeHash: string, now: Date) {
      const row = rows.get(codeHash);
      if (row?.consumedAt !== null) return null;
      const updated: MobileLoginCode = {
        ...row,
        consumedAt: now,
      };
      rows.set(codeHash, updated);
      return { ...updated };
    },

    async findByCodeHash(codeHash: string) {
      return rows.get(codeHash) ?? null;
    },
  };
}

const USER_ID = 'user-1';
const STATE = 'client-generated-state';
const PKCE_VERIFIER = 'a-random-pkce-verifier-string-that-is-long-enough';
const PKCE_CHALLENGE = computeS256PkceChallenge(PKCE_VERIFIER);
const REDIRECT_URI = 'https://app.activitymap.example/auth/callback';
const SESSION_BEARER_TOKEN = 'session-token.signature';

async function issueTestCode(
  repository: MobileLoginCodesRepository,
  now: () => Date,
) {
  return issueMobileLoginCode(
    {
      userId: USER_ID,
      state: STATE,
      pkceChallenge: PKCE_CHALLENGE,
      redirectUri: REDIRECT_URI,
      sessionBearerToken: SESSION_BEARER_TOKEN,
    },
    { repository, now },
  );
}

void test('exchangeMobileLoginCode succeeds for a valid, fresh code', async () => {
  const repository = createFakeRepository();
  const start = new Date('2026-01-01T00:00:00.000Z');
  const { code } = await issueTestCode(repository, () => start);

  const result = await exchangeMobileLoginCode(
    { code, pkceVerifier: PKCE_VERIFIER, state: STATE },
    { repository, now: () => new Date(start.getTime() + 1000) },
  );

  assert.deepEqual(result, {
    bearerToken: SESSION_BEARER_TOKEN,
    userId: USER_ID,
  });
});

void test('exchangeMobileLoginCode rejects a replayed code', async () => {
  const repository = createFakeRepository();
  const start = new Date('2026-01-01T00:00:00.000Z');
  const { code } = await issueTestCode(repository, () => start);
  const exchangeOnce = () =>
    exchangeMobileLoginCode(
      { code, pkceVerifier: PKCE_VERIFIER, state: STATE },
      { repository, now: () => new Date(start.getTime() + 1000) },
    );

  await exchangeOnce();

  await assert.rejects(exchangeOnce(), (error: unknown) => {
    assert.ok(error instanceof MobileAuthError);
    assert.equal(error.code, 'replayed_code');
    return true;
  });
});

void test('exchangeMobileLoginCode rejects two concurrent replay attempts with only one winner', async () => {
  const repository = createFakeRepository();
  const start = new Date('2026-01-01T00:00:00.000Z');
  const { code } = await issueTestCode(repository, () => start);
  const attempt = () =>
    exchangeMobileLoginCode(
      { code, pkceVerifier: PKCE_VERIFIER, state: STATE },
      { repository, now: () => new Date(start.getTime() + 1000) },
    );

  const results = await Promise.allSettled([attempt(), attempt()]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
});

void test('exchangeMobileLoginCode rejects an expired code and then treats it as consumed', async () => {
  const repository = createFakeRepository();
  const start = new Date('2026-01-01T00:00:00.000Z');
  const { code } = await issueTestCode(repository, () => start);
  const wayAfterExpiry = new Date(start.getTime() + 60 * 60 * 1000);

  await assert.rejects(
    exchangeMobileLoginCode(
      { code, pkceVerifier: PKCE_VERIFIER, state: STATE },
      { repository, now: () => wayAfterExpiry },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MobileAuthError);
      assert.equal(error.code, 'expired_code');
      return true;
    },
  );

  // An expired code must not be replayable either, once it has been
  // presented once - it was consumed as part of rejecting it above.
  await assert.rejects(
    exchangeMobileLoginCode(
      { code, pkceVerifier: PKCE_VERIFIER, state: STATE },
      { repository, now: () => wayAfterExpiry },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MobileAuthError);
      assert.equal(error.code, 'replayed_code');
      return true;
    },
  );
});

void test('exchangeMobileLoginCode rejects a state mismatch', async () => {
  const repository = createFakeRepository();
  const start = new Date('2026-01-01T00:00:00.000Z');
  const { code } = await issueTestCode(repository, () => start);

  await assert.rejects(
    exchangeMobileLoginCode(
      { code, pkceVerifier: PKCE_VERIFIER, state: 'a-different-state' },
      { repository, now: () => new Date(start.getTime() + 1000) },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MobileAuthError);
      assert.equal(error.code, 'state_mismatch');
      return true;
    },
  );
});

void test('exchangeMobileLoginCode rejects a PKCE verifier that does not match the challenge', async () => {
  const repository = createFakeRepository();
  const start = new Date('2026-01-01T00:00:00.000Z');
  const { code } = await issueTestCode(repository, () => start);

  await assert.rejects(
    exchangeMobileLoginCode(
      { code, pkceVerifier: 'the-wrong-verifier', state: STATE },
      { repository, now: () => new Date(start.getTime() + 1000) },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MobileAuthError);
      assert.equal(error.code, 'pkce_mismatch');
      return true;
    },
  );
});

void test('exchangeMobileLoginCode rejects a code that was never issued', async () => {
  const repository = createFakeRepository();

  await assert.rejects(
    exchangeMobileLoginCode(
      { code: 'never-issued', pkceVerifier: PKCE_VERIFIER, state: STATE },
      { repository, now: () => new Date() },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MobileAuthError);
      assert.equal(error.code, 'invalid_code');
      return true;
    },
  );
});
