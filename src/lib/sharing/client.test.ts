import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createShareLinksHandler } from '~/app/api/v1/share-links/handler';
import { makeEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import { createShareLink, listMyShareLinks, revokeShareLink } from './client';

const id = '8f75ec62-e2e8-4a0e-93aa-bc06268a72cb';
const createdAt = new Date('2026-10-18T12:00:00Z');
const expiresAt = new Date('2026-10-25T12:00:00Z');
const input = {
  activityIds: ['123', '456'],
  expiresInMs: 604800000,
  fields: { showRouteEnds: true },
};

void test('web create/list/revoke round-trip through the shared handlers using the browser cookie session', async (t) => {
  const actor = {
    userId: 'web-owner',
    athleteId: 42,
    authentication: 'cookie' as const,
  };
  const calls: unknown[] = [];
  const requests: Request[] = [];
  let revokedAt: Date | null = null;
  const deps: Parameters<typeof createShareLinksHandler>[0] = {
    resolveActor: async (request) =>
      request.headers.get('cookie') === 'session=web-owner' ? actor : null,
    create: async (owner, request) => {
      calls.push({ owner, request });
      return {
        id,
        token: 'private-capability',
        createdAt,
        expiresAt,
        fields: input.fields,
        activityIds: request.activityIds,
      };
    },
    list: async (owner) => {
      assert.deepEqual(owner, actor);
      return [
        {
          id,
          createdAt,
          expiresAt,
          revokedAt,
          fields: input.fields,
          activityCount: 2,
          status: revokedAt ? 'revoked' : 'active',
        },
      ];
    },
    revoke: async (owner, shareId) => {
      assert.deepEqual(owner, actor);
      assert.equal(shareId, id);
      revokedAt = new Date('2026-10-18T13:00:00Z');
    },
  };
  t.mock.method(
    globalThis,
    'fetch',
    async (path: string, options: RequestInit) => {
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
      const headers = new Headers(options.headers);
      assert.equal(headers.get('authorization'), null);
      headers.set('Cookie', 'session=web-owner');
      // Browsers attach this to same-origin JSON mutations automatically.
      if (options.method === 'POST')
        headers.set('Origin', 'https://example.test');
      const request = new Request(new URL(path, 'https://example.test'), {
        ...options,
        headers,
      });
      requests.push(request);
      const operation = path.endsWith('/revoke')
        ? 'revoke'
        : options.method === 'GET'
          ? 'list'
          : 'create';
      return createShareLinksHandler(deps, operation)(request);
    },
  );

  const created = await createShareLink(input);
  assert.deepEqual(created, {
    id,
    token: 'private-capability',
    expiresAt: expiresAt.toISOString(),
  });
  assert.deepEqual(calls, [
    { owner: actor, request: { ...input, activityIds: [123, 456] } },
  ]);
  const [active] = await listMyShareLinks();
  assert.deepEqual(active, {
    id,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
    fields: { showRouteEnds: true },
    activityCount: 2,
    status: 'active',
  });
  assert.ok(!JSON.stringify(active).includes('private-capability'));
  await revokeShareLink(id);
  const [revoked] = await listMyShareLinks();
  assert.equal(revoked?.status, 'revoked');
  assert.equal(revoked?.revokedAt, '2026-10-18T13:00:00.000Z');
  assert.deepEqual(
    requests.map((request) => [request.method, new URL(request.url).pathname]),
    [
      ['POST', '/api/v1/share-links'],
      ['GET', '/api/v1/share-links'],
      ['POST', '/api/v1/share-links/revoke'],
      ['GET', '/api/v1/share-links'],
    ],
  );
});

void test('API auth, ownership and throttling messages reach the existing web error UI without retrying', async (t) => {
  let calls = 0;
  for (const [status, code, message] of [
    [401, 'not_authenticated', 'Authentication is required.'],
    [403, 'forbidden', 'Cannot share these activities.'],
    [429, 'rate_limited', 'Too many requests. Try again later.'],
  ] as const) {
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return Response.json(
        errorEnvelope(code, message, { requestId: 'test-request' }),
        { status },
      );
    });
    const before = calls;
    await assert.rejects(createShareLink(input), { message });
    assert.equal(calls, before + 1);
  }
});

void test('malformed proxy and success responses fail without exposing the response or capability token', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('<html>private-capability</html>', { status: 502 }),
  );
  await assert.rejects(listMyShareLinks(), {
    message: 'The share request could not be completed. Please try again.',
  });
  for (const body of [
    {
      ...makeEnvelope({
        id,
        token: 'private-capability',
        expiresAt: expiresAt.toISOString(),
      }),
      schemaVersion: 'next',
    },
    makeEnvelope({ token: 'private-capability' }),
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(createShareLink(input), {
      message:
        'The share response could not be confirmed. Check Your links before trying again.',
    });
  }
});

void test('list forwards cancellation to fetch and discards a result after cancellation', async (t) => {
  const controller = new AbortController();
  t.mock.method(
    globalThis,
    'fetch',
    async (_path: string, options: RequestInit) => {
      assert.equal(options.signal, controller.signal);
      controller.abort();
      return Response.json(makeEnvelope({ links: [] }));
    },
  );
  await assert.rejects(listMyShareLinks(controller.signal), {
    name: 'AbortError',
  });
});
