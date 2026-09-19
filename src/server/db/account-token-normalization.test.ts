import assert from 'node:assert/strict';
import test from 'node:test';
import type { Account } from './schema';
import {
  accountTokenColumnsNeedNormalization,
  buildAccountTokenColumnUpdate,
  resolveAccountTokens,
} from './account-token-normalization';

const account = (overrides: Partial<Account>): Account =>
  ({
    access_token: null,
    accessToken: null,
    refresh_token: null,
    refreshToken: null,
    expires_at: null,
    expiresAt: null,
    accessTokenExpiresAt: null,
    ...overrides,
  }) as Account;

void test('normalizes a fresh Better Auth-only account before token expiry', () => {
  const expiry = new Date('2030-01-01T00:00:00.000Z');
  const source = account({
    accessToken: 'native-access',
    refreshToken: 'native-refresh',
    accessTokenExpiresAt: expiry,
  });
  const resolved = resolveAccountTokens(source);

  assert.equal(resolved.accessToken, 'native-access');
  assert.equal(resolved.refreshToken, 'native-refresh');
  assert.equal(accountTokenColumnsNeedNormalization(source, resolved), true);
  assert.deepEqual(buildAccountTokenColumnUpdate(resolved), {
    access_token: 'native-access',
    accessToken: 'native-access',
    refresh_token: 'native-refresh',
    refreshToken: 'native-refresh',
    expires_at: 1893456000,
    expiresAt: expiry,
    accessTokenExpiresAt: expiry,
  });
});

void test('prefers Better Auth values after reauthorization over stale legacy values', () => {
  const nativeExpiry = new Date('2031-01-01T00:00:00.000Z');
  const resolved = resolveAccountTokens(
    account({
      access_token: 'revoked-legacy-access',
      refresh_token: 'revoked-legacy-refresh',
      expires_at: 1,
      accessToken: 'new-native-access',
      refreshToken: 'new-native-refresh',
      accessTokenExpiresAt: nativeExpiry,
    }),
  );

  assert.equal(resolved.accessToken, 'new-native-access');
  assert.equal(resolved.refreshToken, 'new-native-refresh');
  assert.equal(resolved.expiresAtSeconds, 1924992000);
});

void test('falls back to legacy values and backfills Better Auth columns', () => {
  const source = account({
    access_token: 'legacy-access',
    refresh_token: 'legacy-refresh',
    expires_at: 1893456000,
  });
  const resolved = resolveAccountTokens(source);
  const update = buildAccountTokenColumnUpdate(resolved);

  assert.equal(resolved.accessToken, 'legacy-access');
  assert.equal(resolved.refreshToken, 'legacy-refresh');
  assert.equal(accountTokenColumnsNeedNormalization(source, resolved), true);
  assert.equal(update.accessToken, 'legacy-access');
  assert.equal(update.refreshToken, 'legacy-refresh');
});

void test('does not rewrite token columns that are already synchronized', () => {
  const expiry = new Date('2030-01-01T00:00:00.000Z');
  const source = account({
    access_token: 'access',
    accessToken: 'access',
    refresh_token: 'refresh',
    refreshToken: 'refresh',
    expires_at: 1893456000,
    expiresAt: expiry,
    accessTokenExpiresAt: expiry,
  });

  assert.equal(
    accountTokenColumnsNeedNormalization(source, resolveAccountTokens(source)),
    false,
  );
});
