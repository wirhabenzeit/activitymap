import assert from 'node:assert/strict';

import test from 'node:test';

import type { ErrorEnvelope } from '~/contracts/v1/error';
import type { auth } from '~/lib/auth';

import { withAuthenticatedApiV1 } from './authenticated-boundary';
import { apiFailure, mutationOriginAllowed } from './transport';

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
const policy = {
  route: 'PATCH /api/v1/test',
  cache: 'private-no-store',
} as const;
const request = (credential?: 'cookie' | 'bearer', origin?: string) =>
  new Request('https://app.test/api/v1/test', {
    method: 'PATCH',
    headers: {
      'x-request-id': 'client-request',
      'x-forwarded-for': '192.0.2.1',
      ...(credential === 'cookie'
        ? { cookie: 'better-auth.session_token=opaque' }
        : {}),
      ...(credential === 'bearer' ? { authorization: 'Bearer opaque' } : {}),
      ...(origin ? { origin } : {}),
    },
    body: '{malformed',
  });

for (const credential of ['cookie', 'bearer', undefined] as const) {
  void test(`request boundary resolves ${credential ?? 'no-auth'} session once after pre-auth limits, before user limits and actor authorization`, async () => {
    const seen: string[] = [];
    const handler = withAuthenticatedApiV1(
      async (_request, context) => {
        const actor = await context.actor();
        await context.actor();
        return actor
          ? Response.json({ ok: true })
          : apiFailure(
              context.requestId,
              401,
              'not_authenticated',
              'Authentication is required.',
            );
      },
      policy,
      {
        authentication: {
          resolveSession: async () => {
            seen.push('session');
            return credential ? ({ user: { id: 'owner' } } as Session) : null;
          },
          resolveActor: async (_headers, session) => {
            seen.push('actor');
            return session
              ? { userId: 'owner', athleteId: 42, authentication: credential! }
              : null;
          },
        },
        rateLimit: {
          repo: {
            async incrementAndGet(key) {
              seen.push(key.split(':')[0]!);
              return 1;
            },
          },
        },
      },
    );
    const response = await handler(request(credential));
    assert.equal(response.status, credential ? 200 : 401);
    assert.deepEqual(
      seen,
      credential
        ? ['session', 'ip', 'session', 'user', 'actor']
        : ['ip', 'session', 'actor'],
    );
    assert.equal(response.headers.get('x-request-id'), 'client-request');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('vary'), 'Cookie, Authorization');
    if (!credential)
      assert.equal(
        ((await response.json()) as ErrorEnvelope).error.requestId,
        'client-request',
      );
  });
}

for (const scope of ['session', 'ip', 'user'] as const) {
  void test(`${scope} rejection stops before authorization and preserves retry/request metadata`, async () => {
    let sessions = 0;
    const handler = withAuthenticatedApiV1(
      async () => {
        throw new Error('must not reach handler');
      },
      policy,
      {
        authentication: {
          resolveSession: async () => {
            sessions++;
            return { user: { id: 'owner' } } as Session;
          },
          resolveActor: async () => {
            throw new Error('must not authorize');
          },
        },
        rateLimit: {
          repo: {
            async incrementAndGet(key) {
              return key.startsWith(`${scope}:`) ? 1000 : 1;
            },
          },
        },
      },
    );
    const response = await handler(request('bearer'));
    assert.equal(response.status, 429);
    assert.equal(sessions, scope === 'user' ? 1 : 0);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
    assert.equal(response.headers.get('x-request-id'), 'client-request');
    const { error } = (await response.json()) as ErrorEnvelope;
    assert.equal(error.code, 'rate_limited');
    assert.equal(error.requestId, 'client-request');
    assert.equal(error.retryable, true);
  });
}

void test('unexpected session failures retain stable retryable errors and private headers', async () => {
  let calls = 0;
  const handler = withAuthenticatedApiV1(
    async () => {
      throw new Error('must not reach handler');
    },
    policy,
    {
      authentication: {
        resolveSession: async () => {
          calls++;
          throw new Error('private diagnostic');
        },
        resolveActor: async () => null,
      },
      rateLimit: {
        repo: {
          async incrementAndGet() {
            return 1;
          },
        },
      },
    },
  );
  const response = await handler(request('cookie'));
  assert.equal(response.status, 500);
  assert.equal(calls, 1);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const { error } = (await response.json()) as ErrorEnvelope;
  assert.equal(error.requestId, 'client-request');
  assert.equal(error.retryable, true);
  assert.doesNotMatch(error.message, /private diagnostic/);
});

void test('endpoint cache and redirect policies retain explicit headers and stream retry status', async () => {
  for (const [cache, cacheControl, status] of [
    [{ privateMaxAgeSeconds: 15 }, 'private, max-age=15', 200],
    ['private-no-store', 'private, no-store', 202],
    ['passthrough', null, 302],
  ] as const) {
    const handler = withAuthenticatedApiV1(
      async () =>
        new Response(null, {
          status,
          headers: {
            'Retry-After': '3',
            ...(cacheControl && typeof cache === 'string'
              ? { 'Cache-Control': cacheControl }
              : { Location: 'activitymap://callback' }),
          },
        }),
      { route: 'GET /test', cache },
      {
        authentication: {
          resolveSession: async () => null,
          resolveActor: async () => null,
        },
        rateLimit: {
          repo: {
            async incrementAndGet() {
              return 1;
            },
          },
        },
      },
    );
    const response = await handler(new Request('https://app.test'));
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), cacheControl);
    assert.equal(response.headers.get('retry-after'), '3');
    if (status === 302)
      assert.equal(response.headers.get('location'), 'activitymap://callback');
  }
});

void test('mutation origin policies preserve optional-Origin and strict cookie versus bearer behavior', () => {
  for (const credential of ['cookie', 'bearer', undefined] as const) {
    assert.equal(
      mutationOriginAllowed(request(credential), 'if-present'),
      true,
    );
    assert.equal(
      mutationOriginAllowed(request(credential), 'required-unless-bearer'),
      credential === 'bearer',
    );
    for (const rule of ['if-present', 'required-unless-bearer'] as const) {
      assert.equal(
        mutationOriginAllowed(request(credential, 'https://app.test'), rule),
        true,
      );
      assert.equal(
        mutationOriginAllowed(request(credential, 'https://other.test'), rule),
        false,
      );
    }
  }
});

void test('session-only endpoints reuse user-limit resolution without requiring athlete authorization', async () => {
  let calls = 0;
  const session = {
    user: { id: 'owner' },
    session: { token: 'current-session' },
  } as Session;
  const handler = withAuthenticatedApiV1(
    async (_request, context) => {
      const [first, second] = await Promise.all([
        context.session(),
        context.session(),
      ]);
      assert.equal(first, second);
      assert.equal(first?.session.token, 'current-session');
      return Response.json({ ok: true });
    },
    policy,
    {
      authentication: {
        resolveSession: async () => {
          calls++;
          return session;
        },
        resolveActor: async () => {
          throw new Error(
            'session endpoints must not require a linked athlete',
          );
        },
      },
      rateLimit: {
        repo: {
          async incrementAndGet() {
            return 1;
          },
        },
      },
    },
  );
  assert.equal((await handler(request('cookie'))).status, 200);
  assert.equal(calls, 1);
});

void test('one exported boundary keeps concurrent requests isolated and round-trips generated error IDs', async () => {
  let calls = 0;
  const handler = withAuthenticatedApiV1(
    async (_request, context) => {
      const actor = await context.actor();
      if (!actor)
        return apiFailure(
          context.requestId,
          401,
          'not_authenticated',
          'Authentication is required.',
        );
      return Response.json({ userId: actor.userId });
    },
    policy,
    {
      authentication: {
        resolveSession: async (headers) => {
          calls++;
          const id = headers.get('authorization');
          return id ? ({ user: { id } } as Session) : null;
        },
        resolveActor: async (_headers, session) =>
          session
            ? {
                userId: session.user.id,
                athleteId: 42,
                authentication: 'bearer',
              }
            : null,
      },
      rateLimit: {
        repo: {
          async incrementAndGet() {
            return 1;
          },
        },
      },
    },
  );
  const responses = await Promise.all(
    ['first', 'second'].map((user) =>
      handler(
        new Request('https://app.test', { headers: { authorization: user } }),
      ),
    ),
  );
  assert.deepEqual(
    await Promise.all(
      responses.map(
        (response) => response.json() as Promise<{ userId: string }>,
      ),
    ),
    [{ userId: 'first' }, { userId: 'second' }],
  );
  const unauthorized = await handler(new Request('https://app.test'));
  const { error } = (await unauthorized.json()) as ErrorEnvelope;
  assert.ok(error.requestId);
  assert.equal(unauthorized.headers.get('x-request-id'), error.requestId);
  assert.equal(calls, 3);
});
