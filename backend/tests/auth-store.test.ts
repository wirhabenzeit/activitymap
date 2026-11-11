import assert from 'node:assert/strict';

import { betterAuth } from 'better-auth';
import { convexTest } from 'convex-test';
import test from 'node:test';

import {
  convexAuthAdapter,
  convexAuthStore,
} from '../../src/server/auth/convex-adapter';
import schema from '../convex/schema';

/**
 * The sign-in store end to end: the auth library, its adapter, the signed
 * auth route and backend/convex in convex-test.
 */

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
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
