import assert from 'node:assert/strict';

import { betterAuth } from 'better-auth';
import { convexTest } from 'convex-test';
import test from 'node:test';

import {
  convexAuthAdapter,
  convexAuthStore,
} from '../../src/server/auth/convex-adapter';
import {
  convexRateLimitRepository,
  convexStravaRequestBudget,
} from '../../src/server/auth/convex-app-state';
import { convexMobileLoginCodesRepository } from '../../src/server/auth/convex-mobile-login-codes';
import { convexAuthRecords } from '../../src/server/auth/convex-records';
import {
  eraseDueAccountsOnConvex,
  handleWebhookOnConvex,
} from '../../src/server/strava/convex-webhook';
import {
  StravaBudgetBusyError,
  StravaBudgetExceededError,
} from '../../src/server/strava/request-budget';
import { BridgeResponseError } from '../../src/server/sync/bridge-response-error';
import schema from '../convex/schema';

/**
 * The sign-in store end to end: the auth library, its adapter, the signed
 * auth route and backend/convex in convex-test.
 */

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './appState.ts': () => import('../convex/appState'),
  './authStore.ts': () => import('../convex/authStore'),
  './bridge.ts': () => import('../convex/bridge'),
  './http.ts': () => import('../convex/http'),
};
const secret = 'e'.repeat(64);

function setup(t: test.TestContext) {
  const convex = convexTest(schema, modules);
  const previous = process.env.ACTIVITYMAP_BRIDGE_WRITER_KEYS;
  process.env.ACTIVITYMAP_BRIDGE_WRITER_KEYS = JSON.stringify({ app: secret });
  t.after(() => {
    if (previous === undefined)
      delete process.env.ACTIVITYMAP_BRIDGE_WRITER_KEYS;
    else process.env.ACTIVITYMAP_BRIDGE_WRITER_KEYS = previous;
  });
  const requests: { kind: string; nonce: boolean }[] = [];
  const fetcher: typeof fetch = (url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      nonce?: string;
      operation: { kind: string };
    };
    requests.push({ kind: body.operation.kind, nonce: !!body.nonce });
    return convex.fetch(new URL(String(url)).pathname, init);
  };
  const options = {
    fetcher,
    environment: {
      ACTIVITYMAP_CONVEX_SITE: 'https://convex.invalid',
      ACTIVITYMAP_CONVEX_WRITER_KEY_ID: 'app',
      ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY: secret,
    },
  };
  return { convex, options, requests, call: convexAuthStore(options) };
}

void test('a person can sign up, sign in, be recognized and sign out against the store', async (t) => {
  const { convex, options, requests } = setup(t);
  const auth = betterAuth({
    baseURL: 'https://app.test',
    secret: 'a-secret-that-is-long-enough-for-tests',
    database: convexAuthAdapter(options),
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  });

  const signedUp = await auth.api.signUpEmail({
    body: {
      email: 'Rider@Example.com',
      password: 'correct horse',
      name: 'Rider',
    },
  });
  assert.equal(signedUp.user.email, 'rider@example.com');
  assert(signedUp.user.createdAt instanceof Date);

  await assert.rejects(
    auth.api.signInEmail({
      body: { email: 'rider@example.com', password: 'wrong horse' },
    }),
  );
  const signedIn = await auth.api.signInEmail({
    body: { email: 'rider@example.com', password: 'correct horse' },
    returnHeaders: true,
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  assert.equal(session?.user.id, signedUp.user.id);
  assert.equal(session?.user.name, 'Rider');
  assert(session?.session.expiresAt instanceof Date);
  assert(session.session.expiresAt.getTime() > Date.now());

  // What is stored: one user, one credential account, two sessions (sign-up
  // and sign-in), as documents with their lookup fields.
  const rows = await convex.run((ctx) => ctx.db.query('authRecords').collect());
  assert.deepEqual(rows.map((row) => row.model).sort(), [
    'account',
    'session',
    'session',
    'user',
  ]);
  const stored = rows.find((row) => row.model === 'user')!;
  assert.equal(stored.key, signedUp.user.id);
  assert.equal(stored.email, 'rider@example.com');
  assert.equal(
    typeof (stored.doc as { createdAt: unknown }).createdAt,
    'string',
  );
  assert(
    rows
      .filter((row) => row.model === 'session')
      .every((row) => row.userId === signedUp.user.id && !!row.token),
  );

  await auth.api.signOut({ headers: new Headers({ cookie }) });
  assert.equal(
    await auth.api.getSession({ headers: new Headers({ cookie }) }),
    null,
  );
  assert.equal(
    (await convex.run((ctx) => ctx.db.query('authRecords').collect())).filter(
      (row) => row.model === 'session',
    ).length,
    1,
  );
  // Every change carried a nonce; no read did.
  assert(requests.length > 0);
  for (const request of requests)
    assert.equal(
      request.nonce,
      !['find', 'count'].includes(request.kind),
      request.kind,
    );
});

void test('the store finds, changes and deletes records by the library’s conditions', async (t) => {
  const { call } = setup(t);
  const session = (id: string, userId: string, expiresAt: string) =>
    call({
      kind: 'create',
      model: 'session',
      data: { id, userId, token: `token-${id}`, expiresAt, ipAddress: null },
    });
  await session('s1', 'u1', '2026-11-01T00:00:00.000Z');
  await session('s2', 'u1', '2026-12-01T00:00:00.000Z');
  await session('s3', 'u2', '2026-12-15T00:00:00.000Z');
  const ids = async (operation: Record<string, unknown>) =>
    (
      await call<{ id: string }[]>({
        kind: 'find',
        model: 'session',
        ...operation,
      })
    ).map((row) => row.id);
  const where = (
    field: string,
    value: unknown,
    operator = 'eq',
    connector = 'AND',
  ) => ({
    field,
    value,
    operator,
    connector,
  });

  assert.deepEqual(await ids({ where: [where('id', 's2')] }), ['s2']);
  assert.deepEqual(await ids({ where: [where('token', 'token-s3')] }), ['s3']);
  assert.deepEqual(await ids({ where: [where('userId', 'u1')] }), ['s1', 's2']);
  assert.deepEqual(
    await ids({
      where: [
        where('userId', 'u1'),
        where('expiresAt', '2026-11-15T00:00:00.000Z', 'gt'),
      ],
    }),
    ['s2'],
  );
  assert.deepEqual(
    await ids({ where: [where('id', 's1'), where('id', 's3', 'eq', 'OR')] }),
    ['s1', 's3'],
  );
  assert.deepEqual(await ids({ where: [where('id', ['s1', 's3'], 'in')] }), [
    's1',
    's3',
  ]);
  assert.deepEqual(await ids({ where: [where('userId', 'u1', 'ne')] }), ['s3']);
  assert.deepEqual(await ids({ where: [where('ipAddress', null)] }), [
    's1',
    's2',
    's3',
  ]);
  assert.deepEqual(
    await ids({ where: [where('token', 'token-', 'starts_with')] }),
    ['s1', 's2', 's3'],
  );
  assert.deepEqual(
    await ids({
      sortBy: { field: 'expiresAt', direction: 'desc' },
      limit: 2,
      offset: 1,
    }),
    ['s2', 's1'],
  );
  assert.deepEqual(
    await call({
      kind: 'find',
      model: 'session',
      where: [where('id', 's1')],
      select: ['id', 'userId'],
    }),
    [{ id: 's1', userId: 'u1' }],
  );
  assert.equal(await call({ kind: 'count', model: 'session' }), 3);

  // A change keeps the record's id and moves its lookups with it.
  const moved = await call<{ id: string; userId: string }>({
    kind: 'update',
    model: 'session',
    where: [where('id', 's1')],
    update: { userId: 'u2', id: 'other' },
  });
  assert.deepEqual([moved.id, moved.userId], ['s1', 'u2']);
  assert.deepEqual(await ids({ where: [where('userId', 'u2')] }), ['s1', 's3']);
  assert.equal(
    await call({
      kind: 'update',
      model: 'session',
      where: [where('userId', 'u2')],
      update: { ipAddress: '::1' },
      many: true,
    }),
    2,
  );
  assert.equal(
    await call({
      kind: 'update',
      model: 'session',
      where: [where('id', 'nobody')],
      update: { ipAddress: '::1' },
    }),
    null,
  );

  // Consuming deletes one record and hands it over, once.
  const consumed = await call<{ id: string } | null>({
    kind: 'remove',
    model: 'session',
    where: [where('token', 'token-s2')],
    consume: true,
  });
  assert.equal(consumed?.id, 's2');
  assert.equal(
    await call({
      kind: 'remove',
      model: 'session',
      where: [where('token', 'token-s2')],
      consume: true,
    }),
    null,
  );
  assert.equal(
    await call({
      kind: 'remove',
      model: 'session',
      where: [where('userId', 'u2')],
      many: true,
    }),
    2,
  );
  assert.equal(await call({ kind: 'count', model: 'session' }), 0);
});

void test('the store refuses what it should not serve', async (t) => {
  const { convex, call, options } = setup(t);
  await call({
    kind: 'create',
    model: 'user',
    data: { id: 'u1', email: 'a@b.c' },
  });
  // The same id twice, a model that is not the library's, a record without
  // an id.
  await assert.rejects(
    call({ kind: 'create', model: 'user', data: { id: 'u1', email: 'x@y.z' } }),
  );
  await assert.rejects(
    call({ kind: 'create', model: 'activities', data: { id: 'a1' } }),
  );
  await assert.rejects(call({ kind: 'create', model: 'user', data: {} }));
  await assert.rejects(call({ kind: 'find', model: 'owners' }));

  // Another key, and the library key under the write bridge's domain.
  const stranger = convexAuthStore({
    ...options,
    environment: {
      ...options.environment,
      ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY: 'd'.repeat(64),
    },
  });
  await assert.rejects(stranger({ kind: 'find', model: 'user' }), /\(401\)/);
  const unsigned = await convex.fetch('/internal/auth/v1', {
    method: 'POST',
    body: JSON.stringify({ operation: { kind: 'find', model: 'user' } }),
  });
  assert.equal(unsigned.status, 401);

  // A change replayed with its nonce is refused.
  let replay: [RequestInfo | URL, RequestInit | undefined] | undefined;
  const recording = convexAuthStore({
    ...options,
    fetcher: (url, init) => {
      replay = [url, init];
      return options.fetcher(url, init);
    },
  });
  await recording({
    kind: 'create',
    model: 'user',
    data: { id: 'u2', email: 'c@d.e' },
  });
  const again = await options.fetcher(...replay!);
  assert.equal(again.status, 409);
  assert.equal(await call({ kind: 'count', model: 'user' }), 2);
});

/** A user with a linked Strava account, as a sign-in leaves them. */
async function person(
  call: ReturnType<typeof convexAuthStore>,
  id: string,
  athleteId: number,
  extra: Record<string, unknown> = {},
) {
  await call({
    kind: 'create',
    model: 'user',
    data: { id, name: 'Rider', athlete_id: athleteId, ...extra },
  });
  await call({
    kind: 'create',
    model: 'account',
    data: {
      id: `account-${id}`,
      userId: id,
      providerId: 'strava',
      accountId: String(athleteId),
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: '2026-11-11T12:00:00.000Z',
    },
  });
}

void test('Strava credentials are refreshed once, and never over a newer sign-in', async (t) => {
  const { call } = setup(t);
  await person(call, 'u1', 42);
  const records = convexAuthRecords(call);
  const user = await records.user('u1');
  assert.deepEqual(
    [user?.athlete_id, user?.writer, user?.convexEpoch, user?.emailVerified],
    [42, 'postgres', null, false],
  );
  const read = (await records.accounts.findStravaAccount({ userId: 'u1' }))!;
  assert.equal(
    read.accessTokenExpiresAt?.toISOString(),
    '2026-11-11T12:00:00.000Z',
  );
  const fresh = (suffix: string) => ({
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresAtSeconds: 1_800_000_000,
    expiresAtDate: new Date(1_800_000_000_000),
  });

  // Two refreshes start from the same credentials: one is saved.
  const [first, second] = await Promise.all([
    records.accounts.replaceCredentials(read, fresh('2')),
    records.accounts.replaceCredentials(read, fresh('3')),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  const saved = (await records.accounts.findStravaAccount({
    accountId: '42',
  }))!;
  assert.equal(saved.accessToken, (first ?? second)!.accessToken);
  assert.equal(saved.access_token, saved.accessToken);
  assert.equal(saved.accessTokenExpiresAt?.getTime(), 1_800_000_000_000);

  // The person signs in again, which writes new tokens; a refresh that
  // read the account before that is refused.
  await call({
    kind: 'update',
    model: 'account',
    where: [
      { field: 'id', value: 'account-u1', operator: 'eq', connector: 'AND' },
    ],
    update: { accessToken: 'signed-in-again' },
  });
  assert.equal(
    await records.accounts.replaceCredentials(saved, fresh('4')),
    null,
  );
  assert.equal(
    (await records.accounts.findStravaAccount({ userId: 'u1' }))!.accessToken,
    'signed-in-again',
  );

  assert.equal(
    await records.updateUser('u1', {
      writer: 'convex',
      convexEpoch: 'e'.repeat(20),
    }),
    true,
  );
  assert.deepEqual(
    [
      (await records.user('u1'))?.writer,
      (await records.user('u1'))?.convexEpoch,
    ],
    ['convex', 'e'.repeat(20)],
  );
  assert.equal(await records.updateUser('nobody', { writer: 'convex' }), false);
});

void test('a webhook is recorded in Convex or revokes the account, and a failure is passed on', async (t) => {
  const { call } = setup(t);
  await person(call, 'u1', 42, { writer: 'convex' });
  await person(call, 'u2', 43);
  const records = convexAuthRecords(call);
  const sent: unknown[] = [];
  const send = async (owner: unknown, event: unknown) =>
    void sent.push([owner, event]);
  const event = (overrides: object = {}) => ({
    subscription_id: 1,
    object_type: 'activity' as const,
    object_id: 7,
    aspect_type: 'update' as const,
    owner_id: 42,
    event_time: 1_794_000_000,
    ...overrides,
  });
  const handle = (data: ReturnType<typeof event>) =>
    handleWebhookOnConvex(data as never, {
      records,
      send: send as never,
      now: () => new Date('2026-11-11T10:00:00Z'),
    });

  assert.equal(await handle(event()), 'recorded');
  assert.equal(await handle(event()), 'recorded');
  const [[owner, first], [, repeat]] = sent as [
    [
      unknown,
      { event: string; activityId: string; aspect: string; eventTime: number },
    ],
    [unknown, { event: string }],
  ];
  assert.deepEqual(owner, { userId: 'u1', athleteId: 42 });
  assert.deepEqual(
    [first.activityId, first.aspect, first.eventTime],
    ['7', 'update', 1_794_000_000_000],
  );
  // A repeated delivery carries the same ID, so Convex records it once.
  assert.match(first.event, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(repeat.event, first.event);

  // An athlete nobody here knows, and one whose library has not started.
  assert.equal(await handle(event({ owner_id: 99 })), 'ignored');
  assert.equal(await handle(event({ owner_id: 43 })), 'ignored');
  assert.equal(sent.length, 2);

  // Convex could not take it: the caller answers Strava with an error.
  await assert.rejects(
    handleWebhookOnConvex(event() as never, {
      records,
      send: async () => {
        throw new Error('unreachable');
      },
    }),
    /unreachable/,
  );

  // Access withdrawn: tokens gone, erasure in thirty days, and a repeat of
  // the notice does not move the date.
  const withdrawn = event({
    object_type: 'athlete',
    object_id: 42,
    updates: { authorized: 'false' },
  });
  assert.equal(await handle(withdrawn), 'revoked');
  assert.equal(await handle(withdrawn), 'ignored');
  const account = (await records.accountByAthlete(42))!;
  assert.deepEqual(
    [
      account.accessToken,
      account.refreshToken,
      account.scheduledErasureAt?.toISOString(),
    ],
    [null, null, '2026-12-11T10:00:00.000Z'],
  );
  assert.equal(
    await handle(
      event({
        object_type: 'athlete',
        object_id: 43,
        owner_id: 43,
        updates: { title: 'x' },
      }),
    ),
    'ignored',
  );
  assert.equal((await records.accountByAthlete(43))!.revokedAt, null);
});

void test('revoked accounts are erased when due, and one that signed in again is kept', async (t) => {
  const { call } = setup(t);
  const records = convexAuthRecords(call);
  await person(call, 'gone', 42);
  await person(call, 'back', 43);
  await person(call, 'later', 44);
  const now = new Date('2026-12-20T00:00:00Z');
  const past = new Date('2026-12-01T00:00:00Z');
  for (const athlete of [42, 43])
    await records.revokeAccount(
      (await records.accountByAthlete(athlete))!.id,
      new Date('2026-11-01T00:00:00Z'),
      past,
    );
  await records.revokeAccount(
    (await records.accountByAthlete(44))!.id,
    now,
    new Date('2027-01-19T00:00:00Z'),
  );
  // `back` signed in again: the library writes tokens next to the marks.
  await call({
    kind: 'update',
    model: 'account',
    where: [
      { field: 'id', value: 'account-back', operator: 'eq', connector: 'AND' },
    ],
    update: { accessToken: 'new' },
  });
  await call({
    kind: 'create',
    model: 'session',
    data: {
      id: 's1',
      userId: 'gone',
      token: 't1',
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
  const erasedLibraries: string[] = [];

  const result = await eraseDueAccountsOnConvex({
    records,
    now,
    eraseLibrary: async (user) => void erasedLibraries.push(user.id),
  });

  assert.deepEqual(result, {
    candidates: 2,
    erased: 1,
    cancelled: 1,
    failed: 0,
  });
  assert.deepEqual(erasedLibraries, ['gone']);
  assert.equal(await records.user('gone'), null);
  assert.equal(await records.accountByAthlete(42), null);
  assert.equal(await call({ kind: 'count', model: 'session' }), 0);
  const kept = (await records.accountByAthlete(43))!;
  assert.deepEqual(
    [kept.revokedAt, kept.scheduledErasureAt, kept.accessToken],
    [null, null, 'new'],
  );
  assert.notEqual((await records.accountByAthlete(44))!.revokedAt, null);

  // A library that cannot be erased keeps its records for the next run.
  await records.revokeAccount(kept.id, new Date('2026-11-01T00:00:00Z'), past);
  const failed = await eraseDueAccountsOnConvex({
    records,
    now,
    eraseLibrary: async () => {
      throw new Error('Convex unreachable');
    },
  });
  assert.deepEqual(failed, {
    candidates: 1,
    erased: 0,
    cancelled: 0,
    failed: 1,
  });
  assert.notEqual(await records.user('back'), null);
});

void test('a mobile login code is consumed once and gives up its session token once', async (t) => {
  const { call } = setup(t);
  const codes = convexMobileLoginCodesRepository(call);
  const created = await codes.create({
    codeHash: 'hash-1',
    state: 'state',
    pkceChallenge: 'challenge',
    redirectUri: 'activitymap://callback',
    userId: 'u1',
    sessionBearerToken: 'bearer',
    expiresAt: new Date('2026-11-11T10:05:00Z'),
  });
  assert.equal(created.consumedAt, null);
  assert.equal(
    (await codes.findByCodeHash('hash-1'))?.sessionBearerToken,
    'bearer',
  );

  const now = new Date('2026-11-11T10:01:00Z');
  const [first, second] = await Promise.all([
    codes.consumeByCodeHash('hash-1', now),
    codes.consumeByCodeHash('hash-1', now),
  ]);
  const winner = first ?? second;
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.deepEqual(
    [
      winner?.sessionBearerToken,
      winner?.consumedAt?.toISOString(),
      winner?.expiresAt.toISOString(),
    ],
    ['bearer', now.toISOString(), '2026-11-11T10:05:00.000Z'],
  );
  const after = await codes.findByCodeHash('hash-1');
  assert.deepEqual(
    [after?.sessionBearerToken, after?.consumedAt?.toISOString()],
    [null, now.toISOString()],
  );
  assert.equal(await codes.consumeByCodeHash('unknown', now), null);
});

void test('rate limit windows count exactly and the provider budget holds requests back', async (t) => {
  const { convex, call } = setup(t);
  const limits = convexRateLimitRepository(call);
  const window = new Date('2026-11-11T10:00:00Z');
  const counts = await Promise.all(
    Array.from({ length: 5 }, () => limits.incrementAndGet('user:u1', window)),
  );
  assert.deepEqual([...counts].sort(), [1, 2, 3, 4, 5]);
  assert.equal(await limits.incrementAndGet('user:u2', window), 1);
  assert.equal(
    await limits.incrementAndGet('user:u1', new Date('2026-11-11T10:01:00Z')),
    1,
  );
  assert.equal(
    await limits.deleteWindowsBefore(new Date('2026-11-11T10:00:30Z')),
    2,
  );
  assert.equal(await limits.incrementAndGet('user:u1', window), 1);

  const budget = convexStravaRequestBudget(undefined, call);
  const ticket = await budget.reserve(true);
  assert.equal(ticket.read, true);
  const rows = () =>
    convex.run((ctx) => ctx.db.query('providerBudget').collect());
  assert.deepEqual(
    (await rows()).map((row) => [row.key, row.used, row.inFlight]).sort(),
    [
      ['overall:15m', 1, 1],
      ['overall:day', 1, 1],
      ['read:15m', 1, 1],
      ['read:day', 1, 1],
    ],
  );
  // One request in flight is the most this caller allows.
  const careful = convexStravaRequestBudget(
    { fifteenMinutes: 0, daily: 0, maxInFlight: 1 },
    call,
  );
  await assert.rejects(careful.reserve(false), StravaBudgetBusyError);

  // The provider reports the quarter hour nearly used up: the next request
  // waits for the window, and nothing was reserved for it.
  await budget.observe(
    ticket,
    {
      overall: {
        limit15Minutes: 200,
        limitDaily: 2000,
        usage15Minutes: 180,
        usageDaily: 300,
      },
      read: {
        limit15Minutes: 100,
        limitDaily: 1000,
        usage15Minutes: 40,
        usageDaily: 200,
      },
    } as never,
    200,
  );
  const before = await rows();
  assert.equal(before.find((row) => row.key === 'overall:15m')!.inFlight, 0);
  await assert.rejects(budget.reserve(true), (error: unknown) => {
    assert(error instanceof StravaBudgetExceededError);
    assert(!(error instanceof StravaBudgetBusyError));
    assert(error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= 900);
    return true;
  });
  assert.deepEqual(await rows(), before);
});

void test('batched rate limits retain ordered rejection and do not count later buckets', async (t) => {
  const { call, requests } = setup(t);
  const limits = convexRateLimitRepository(call);
  const windows = [
    { key: 'session:batch', windowStart: 0, limit: 1 },
    { key: 'ip:batch', windowStart: 0, limit: 10 },
  ];
  assert.deepEqual(await limits.incrementManyAndGet!(windows), [1, 1]);
  assert.deepEqual(await limits.incrementManyAndGet!(windows), [2]);
  assert.equal(await limits.incrementAndGet('ip:batch', new Date(0)), 2);
  assert.equal(
    requests.filter((request) => request.kind === 'rateLimits').length,
    2,
  );
});

void test('rate limits survive app-first rollout and use batching automatically after upgrade', async (t) => {
  const { convex, options } = setup(t);
  let upgraded = false;
  const operations: string[] = [];
  const limits = convexRateLimitRepository(
    convexAuthStore({
      ...options,
      fetcher: async (url, init) => {
        const { operation } = JSON.parse(String(init?.body)) as {
          operation: { kind: string };
        };
        operations.push(operation.kind);
        // The previous auth HTTP action returns an empty 400 for unknown kinds.
        if (!upgraded && operation.kind === 'rateLimits')
          return new Response(null, { status: 400 });
        return options.fetcher(url, init);
      },
    }),
  );
  const windows = [
    { key: 'session:rollout', windowStart: 0, limit: 2 },
    { key: 'ip:rollout', windowStart: 0, limit: 10 },
  ];
  assert.deepEqual(await limits.incrementManyAndGet!(windows), [1, 1]);
  assert.deepEqual(await limits.incrementManyAndGet!(windows), [2, 2]);
  assert.deepEqual(await limits.incrementManyAndGet!(windows), [3]);
  const ip = await convex.run((ctx) =>
    ctx.db
      .query('rateLimits')
      .withIndex('by_key_window', (q) =>
        q.eq('key', 'ip:rollout').eq('windowStart', 0),
      )
      .unique(),
  );
  assert.equal(
    ip!.count,
    2,
    'rejected session must not count the later IP bucket',
  );
  upgraded = true;
  operations.length = 0;
  assert.deepEqual(
    await limits.incrementManyAndGet!(
      windows.map((window) => ({ ...window, windowStart: 1000 })),
    ),
    [1, 1],
  );
  assert.deepEqual(operations, ['rateLimits']);
  upgraded = false;
  operations.length = 0;
  assert.deepEqual(
    await limits.incrementManyAndGet!(
      windows.map((window) => ({ ...window, windowStart: 1000 })),
    ),
    [2, 2],
  );
  assert.deepEqual(operations, ['rateLimits', 'rateLimit', 'rateLimit']);
});

void test('rate-limit compatibility never falls back on authorization, conflict, server or transport failures', async (t) => {
  const { options } = setup(t);
  const windows = [{ key: 'session:rollout', windowStart: 0, limit: 2 }];
  for (const status of [401, 403, 409, 429, 500, 503]) {
    let requests = 0;
    const limits = convexRateLimitRepository(
      convexAuthStore({
        ...options,
        fetcher: async () => {
          requests++;
          return new Response(null, { status });
        },
      }),
    );
    await assert.rejects(
      limits.incrementManyAndGet!(windows),
      (error: unknown) =>
        error instanceof BridgeResponseError && error.status === status,
    );
    assert.equal(requests, 1);
  }
  let requests = 0;
  const limits = convexRateLimitRepository(
    convexAuthStore({
      ...options,
      fetcher: async () => {
        requests++;
        throw new TypeError('network unavailable');
      },
    }),
  );
  await assert.rejects(
    limits.incrementManyAndGet!(windows),
    /network unavailable/,
  );
  assert.equal(requests, 1);
});
