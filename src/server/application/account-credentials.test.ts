import assert from 'node:assert/strict';
import test from 'node:test';
import type { Account } from '~/server/db/schema';
import {
  buildAccountTokenColumnUpdate,
  resolveAccountTokens,
} from '~/server/db/account-token-normalization';
import type { AccountsRepository } from '~/server/repositories/accounts';
import { StravaApiError, type StravaTokens } from '~/server/strava/client';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';
import {
  AccountCredentialsUnavailableError,
  AccountPersistenceError,
  createAccountCredentialsService,
} from './account-credentials';

const NOW = Date.UTC(2030, 0, 1);
const fresh = buildAccountTokenColumnUpdate({
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAtSeconds: NOW / 1000 + 3600,
  expiresAtDate: new Date(NOW + 3600_000),
});
const rotated: StravaTokens = {
  access_token: 'rotated',
  refresh_token: 'rotated-refresh',
  expires_at: NOW / 1000 + 7200,
  expires_in: 7200,
};
function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'grant',
    userId: 'owner',
    accountId: '123',
    providerId: 'strava',
    updatedAt: new Date(NOW),
    revokedAt: null,
    scheduledErasureAt: null,
    ...fresh,
    ...overrides,
  } as Account;
}

function fixture(
  initial: Account | null = account(),
  refresh?: () => Promise<StravaTokens>,
) {
  let row = initial;
  let writes = 0,
    calls = 0;
  let persistenceError: Error | undefined;
  const version = (value: Account) => JSON.stringify(value);
  const write = async (expected: Account, update: Partial<Account>) => {
    writes++;
    if (persistenceError) throw persistenceError;
    if (!row || version(row) !== version(expected)) return null;
    row = { ...row, ...update };
    return row;
  };
  const repository: AccountsRepository = {
    findStravaAccount: async () => row && { ...row },
    normalizeCredentials: (expected, tokens) =>
      write(expected, buildAccountTokenColumnUpdate(tokens)),
    reconnect: (expected) =>
      write(expected, { revokedAt: null, scheduledErasureAt: null }),
    replaceCredentials: (expected, tokens) =>
      write(expected, buildAccountTokenColumnUpdate(tokens)),
  };
  const service = createAccountCredentialsService({
    repository,
    clock: () => NOW,
    createClient: (token, persist) => ({
      async refreshAccessToken() {
        assert.equal(token, 'refresh');
        calls++;
        const tokens = refresh ? await refresh() : rotated;
        await persist(tokens);
        return tokens;
      },
    }),
  });
  return {
    service,
    get row() {
      return row;
    },
    set row(value) {
      row = value;
    },
    get writes() {
      return writes;
    },
    get calls() {
      return calls;
    },
    failPersistence(error: Error) {
      persistenceError = error;
    },
  };
}

void test('explicit lookup is read only; fresh credentials do not refresh or write', async () => {
  const f = fixture();
  assert.equal(
    (await f.service.lookupAccount({ userId: 'owner' }))?.id,
    'grant',
  );
  assert.equal(
    (await f.service.getAccountWithCredentials({ userId: 'owner' }))
      ?.access_token,
    'access',
  );
  assert.equal(f.writes, 0);
  assert.equal(f.calls, 0);
  await assert.rejects(() => f.service.lookupAccount({} as never), TypeError);
  await assert.rejects(
    () => f.service.lookupAccount({ userId: 'someone-else' }),
    AccountCredentialsUnavailableError,
  );
  await assert.rejects(
    () => f.service.lookupAccount({ accountId: 'different' }),
    AccountCredentialsUnavailableError,
  );
});

void test('native tokens remain authoritative and compatibility writes mirror every column', async () => {
  const f = fixture(
    account({ access_token: 'stale', refresh_token: 'stale', expires_at: 1 }),
  );
  await f.service.getAccountWithCredentials({ userId: 'owner' });
  assert.equal(f.writes, 1);
  assert.equal(f.calls, 0);
  assert.equal(f.row?.access_token, 'access');
  assert.equal(f.row?.refresh_token, 'refresh');
  assert.equal(f.row?.expires_at, NOW / 1000 + 3600);
  assert.deepEqual(f.row?.accessTokenExpiresAt, f.row?.expiresAt);
});

void test('legacy-only tokens retain offline compatibility and backfill native columns', async () => {
  const f = fixture(
    account({
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      expiresAt: null,
    }),
  );
  const result = await f.service.getAccountWithCredentials({ userId: 'owner' });
  assert.equal(result?.accessToken, 'access');
  assert.equal(result?.refreshToken, 'refresh');
  assert.equal(f.calls, 0);
  assert.equal(f.writes, 1);
});

for (const input of [
  'expired',
  'unknown-expiry',
  'force',
  'missing-access',
] as const) {
  void test(`${input} credentials refresh and persist both representations before returning`, async () => {
    const overrides: Partial<Account> =
      input === 'expired'
        ? buildAccountTokenColumnUpdate({
            ...resolveAccountTokens(account()),
            expiresAtSeconds: NOW / 1000,
            expiresAtDate: new Date(NOW),
          })
        : input === 'unknown-expiry'
          ? { expires_at: null, expiresAt: null, accessTokenExpiresAt: null }
          : input === 'missing-access'
            ? { accessToken: null, access_token: null }
            : {};
    const f = fixture(account(overrides));
    const result = await f.service.getAccountWithCredentials({
      userId: 'owner',
      forceRefresh: input === 'force',
    });
    assert.equal(result?.access_token, rotated.access_token);
    assert.equal(result?.accessToken, rotated.access_token);
    assert.equal(result?.refreshToken, rotated.refresh_token);
    assert.equal(result?.refresh_token, rotated.refresh_token);
    assert.equal(result?.expires_at, rotated.expires_at);
    assert.deepEqual(
      result?.accessTokenExpiresAt,
      new Date(rotated.expires_at * 1000),
    );
    assert.equal(f.calls, 1);
    assert.equal(f.writes, 1);
  });
}

void test('missing account/refresh credentials and revoked grants never call Strava', async () => {
  const missing = fixture(null);
  assert.equal(
    await missing.service.getAccountWithCredentials({
      accountId: 'unknown-webhook-athlete',
    }),
    null,
  );
  await assert.rejects(
    () => missing.service.getAccountWithCredentials({ userId: 'owner' }),
    AccountCredentialsUnavailableError,
  );
  for (const overrides of [
    {
      accessToken: null,
      access_token: null,
      refreshToken: null,
      refresh_token: null,
    },
    {
      accessToken: null,
      access_token: null,
      revokedAt: new Date(NOW),
      scheduledErasureAt: new Date(NOW),
    },
  ]) {
    const f = fixture(account(overrides));
    await assert.rejects(
      () => f.service.getAccountWithCredentials({ userId: 'owner' }),
      AccountCredentialsUnavailableError,
    );
    assert.equal(f.calls, 0);
    assert.equal(f.writes, 0);
  }
});

void test('reconnection is an explicit guarded transition, independent from token normalization', async () => {
  const f = fixture(
    account({
      revokedAt: new Date(NOW - 100),
      scheduledErasureAt: new Date(NOW + 1000),
    }),
  );
  const read = await f.service.lookupAccount({ userId: 'owner' });
  assert.ok(read?.revokedAt);
  assert.equal(f.writes, 0);
  const result = await f.service.getAccountWithCredentials({ userId: 'owner' });
  assert.equal(result?.revokedAt, null);
  assert.equal(result?.scheduledErasureAt, null);
  assert.equal(f.calls, 0);
  assert.equal(f.writes, 1);
});

for (const error of [
  new StravaApiError('limited', 429, undefined, 123),
  new StravaApiError('unauthorized', 401),
  new StravaApiError('unavailable', 503, undefined, 77),
  new StravaBudgetExceededError(321),
]) {
  void test(`refresh preserves original ${error.name}/${'status' in error ? error.status : 'budget'} failure and metadata`, async () => {
    const f = fixture(account(), async () => {
      throw error;
    });
    await assert.rejects(
      () =>
        f.service.getAccountWithCredentials({
          userId: 'owner',
          forceRefresh: true,
        }),
      (caught) => caught === error,
    );
    assert.equal(f.writes, 0);
    assert.equal(f.row?.accessToken, 'access');
  });
}

void test('failed local persistence retains its cause and upstream-success distinction', async () => {
  const failed = new Error('database unavailable');
  const normalization = fixture(account({ access_token: 'old' }));
  normalization.failPersistence(failed);
  await assert.rejects(
    () => normalization.service.getAccountWithCredentials({ userId: 'owner' }),
    (e) =>
      e instanceof AccountPersistenceError &&
      e.cause === failed &&
      !e.upstreamSucceeded,
  );
  const refresh = fixture();
  refresh.failPersistence(failed);
  await assert.rejects(
    () =>
      refresh.service.getAccountWithCredentials({
        userId: 'owner',
        forceRefresh: true,
      }),
    (e) =>
      e instanceof AccountPersistenceError &&
      e.cause === failed &&
      e.upstreamSucceeded,
  );
  assert.equal(refresh.row?.accessToken, 'access');
});

for (const change of [
  'revocation',
  'reauthorization',
  'deletion',
  'recreation',
] as const) {
  void test(`late refresh cannot overwrite concurrent ${change}`, async () => {
    let release!: (value: StravaTokens) => void;
    let started!: () => void;
    const running = new Promise<void>((r) => {
      started = r;
    });
    const gate = new Promise<StravaTokens>((r) => {
      release = r;
    });
    const f = fixture(account(), () => {
      started();
      return gate;
    });
    const attempt = f.service.getAccountWithCredentials({
      userId: 'owner',
      forceRefresh: true,
    });
    await running;
    f.row =
      change === 'deletion'
        ? null
        : account(
            change === 'revocation'
              ? {
                  revokedAt: new Date(NOW),
                  scheduledErasureAt: new Date(NOW),
                  accessToken: null,
                  access_token: null,
                  refreshToken: null,
                  refresh_token: null,
                }
              : change === 'recreation'
                ? { id: 'replacement' }
                : {
                    accessToken: 'new-authorization',
                    refreshToken: 'new-refresh',
                  },
          );
    const expected = structuredClone(f.row);
    release(rotated);
    await assert.rejects(
      () => attempt,
      (e) =>
        e instanceof AccountCredentialsUnavailableError &&
        e.reason === 'changed',
    );
    assert.deepEqual(f.row, expected);
  });
}

void test('read failures propagate unchanged and are never treated as missing identity', async () => {
  const failure = new Error('read outage');
  const repository = {
    findStravaAccount: async () => {
      throw failure;
    },
  } as unknown as AccountsRepository;
  const service = createAccountCredentialsService({
    repository,
    clock: () => NOW,
    createClient: () => {
      throw new Error('unexpected');
    },
  });
  await assert.rejects(
    () => service.getAccountWithCredentials({ userId: 'owner' }),
    (e) => e === failure,
  );
});
