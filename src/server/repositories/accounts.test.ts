import assert from 'node:assert/strict';

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import test from 'node:test';

import {
  buildAccountTokenColumnUpdate,
  resolveAccountTokens,
} from '~/server/db/account-token-normalization';
import type { Account } from '~/server/db/schema';
import { accounts, users } from '~/server/db/schema';

import { accountCredentialVersion, createAccountsRepository } from './accounts';

const NOW = new Date('2030-01-01');
function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'grant',
    userId: 'owner',
    accountId: '123',
    providerId: 'strava',
    updatedAt: NOW,
    revokedAt: null,
    scheduledErasureAt: null,
    ...buildAccountTokenColumnUpdate({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAtSeconds: 2000000000,
      expiresAtDate: new Date(2000000000000),
    }),
    ...overrides,
  } as Account;
}
function fake(initial: Account | null, userExists = true) {
  let row = initial;
  const calls: {
    table: unknown;
    lock?: string;
    query?: { sql: string; params: unknown[] };
  }[] = [];
  const writes: unknown[] = [];
  let failWrite: Error | undefined;
  const dialect = new PgDialect();
  const tx = {
    select() {
      return {
        from(table: unknown) {
          return {
            where(predicate: SQL) {
              return {
                async for(lock: string) {
                  calls.push({
                    table,
                    lock,
                    query: dialect.sqlToQuery(predicate),
                  });
                  return table === users
                    ? userExists
                      ? [{ id: 'owner' }]
                      : []
                    : row
                      ? [row]
                      : [];
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(update: Partial<Account>) {
          return {
            where(predicate: SQL) {
              return {
                async returning() {
                  calls.push({ table, query: dialect.sqlToQuery(predicate) });
                  if (failWrite) throw failWrite;
                  writes.push(update);
                  row = row ? { ...row, ...update } : null;
                  return row ? [row] : [];
                },
              };
            },
          };
        },
      };
    },
  };
  const db = {
    query: {
      accounts: {
        findFirst: async ({ where }: { where: SQL }) => {
          calls.push({ table: accounts, query: dialect.sqlToQuery(where) });
          return row;
        },
      },
    },
    transaction: async (operation: (handle: typeof tx) => Promise<unknown>) =>
      operation(tx),
  };
  const repo = createAccountsRepository(
    db as unknown as Parameters<typeof createAccountsRepository>[0],
  );
  return {
    repo,
    calls,
    writes,
    get row() {
      return row;
    },
    fail(error: Error) {
      failWrite = error;
    },
  };
}

void test('lookup constrains provider and both explicit ownership identities without a write', async () => {
  const f = fake(account());
  await f.repo.findStravaAccount({ userId: 'owner', accountId: '123' });
  const query = f.calls[0]!.query!;
  assert.match(query.sql, /"providerId"/);
  assert.match(query.sql, /"userId"/);
  assert.match(query.sql, /"accountId"/);
  assert.deepEqual(query.params, ['strava', 'owner', '123']);
  assert.equal(f.writes.length, 0);
  await assert.rejects(() => f.repo.findStravaAccount({} as never), TypeError);
});

void test('credential replacement locks the user before the account and writes both token formats', async () => {
  const original = account();
  const f = fake(original);
  const tokens = {
    accessToken: 'rotated',
    refreshToken: 'rotated-refresh',
    expiresAtSeconds: 2100000000,
    expiresAtDate: new Date(2100000000000),
  };
  const result = await f.repo.replaceCredentials(original, tokens);
  assert.deepEqual(
    f.calls.filter((c) => c.lock).map((c) => [c.table, c.lock]),
    [
      [users, 'key share'],
      [accounts, 'update'],
    ],
  );
  assert.deepEqual(f.calls[0]!.query!.params, ['owner', 123]);
  assert.deepEqual(f.calls[1]!.query!.params, [
    'grant',
    'owner',
    '123',
    'strava',
  ]);
  assert.deepEqual(f.writes, [buildAccountTokenColumnUpdate(tokens)]);
  assert.equal(result?.accessToken, 'rotated');
  assert.equal(result?.access_token, 'rotated');
});

for (const change of [
  { accessToken: 'reauthorized' },
  { refreshToken: 'reauthorized' },
  { access_token: 'legacy-change' },
  { revokedAt: new Date('2030-01-02') },
  { scheduledErasureAt: new Date('2030-02-01') },
  { id: 'recreated' },
  { userId: 'another-owner' },
  { accountId: '456' },
  { providerId: 'other-provider' },
  { updatedAt: new Date('2030-01-02') },
]) {
  void test(`stale credential/reconnection snapshot rejects ${Object.keys(change)[0]}`, async () => {
    const original = account();
    const f = fake(account(change));
    assert.equal(
      await f.repo.replaceCredentials(original, resolveAccountTokens(original)),
      null,
    );
    assert.equal(
      await f.repo.normalizeCredentials(
        original,
        resolveAccountTokens(original),
      ),
      null,
    );
    assert.equal(await f.repo.reconnect(original), null);
    assert.equal(f.writes.length, 0);
  });
}

void test('deleted user or account rejects every credential write', async () => {
  for (const f of [fake(account(), false), fake(null)]) {
    const original = account();
    assert.equal(
      await f.repo.replaceCredentials(original, resolveAccountTokens(original)),
      null,
    );
    assert.equal(
      await f.repo.normalizeCredentials(
        original,
        resolveAccountTokens(original),
      ),
      null,
    );
    assert.equal(await f.repo.reconnect(original), null);
    assert.equal(f.writes.length, 0);
  }
});

void test('revoked grants cannot normalize/refresh; only live reauthorization clears erasure markers', async () => {
  const revoked = account({
    accessToken: null,
    access_token: null,
    revokedAt: NOW,
    scheduledErasureAt: NOW,
  });
  const f = fake(revoked);
  assert.equal(await f.repo.reconnect(revoked), null);
  assert.equal(
    await f.repo.normalizeCredentials(revoked, resolveAccountTokens(revoked)),
    null,
  );
  assert.equal(
    await f.repo.replaceCredentials(revoked, resolveAccountTokens(account())),
    null,
  );
  assert.equal(f.writes.length, 0);
  const reauthorized = account({ revokedAt: NOW, scheduledErasureAt: NOW });
  const connected = fake(reauthorized);
  const result = await connected.repo.reconnect(reauthorized);
  assert.deepEqual(connected.writes, [
    { revokedAt: null, scheduledErasureAt: null },
  ]);
  assert.equal(result?.accessToken, 'access');
});

void test('a persistence failure is not returned as a successful credential replacement', async () => {
  const f = fake(account());
  const failure = new Error('transaction failed');
  f.fail(failure);
  await assert.rejects(
    () => f.repo.replaceCredentials(account(), resolveAccountTokens(account())),
    (e) => e === failure,
  );
});

void test('credential version includes legacy and native token columns and both revocation markers', () => {
  const original = account();
  for (const change of [
    { accessToken: 'x' },
    { access_token: 'x' },
    { refreshToken: 'x' },
    { refresh_token: 'x' },
    { revokedAt: NOW },
    { scheduledErasureAt: NOW },
    { accessTokenExpiresAt: NOW },
    { expiresAt: NOW },
    { expires_at: 1 },
  ]) {
    assert.notEqual(
      accountCredentialVersion(original),
      accountCredentialVersion(account(change)),
    );
  }
});
