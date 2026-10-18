import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createShareLinksHandler } from './handler';
import {
  ForbiddenError,
  ShareLinkNotFoundError,
} from '~/server/application/share-links';
import type { Actor } from '~/server/auth/actor';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'bearer',
};
const id = '8f75ec62-e2e8-4a0e-93aa-bc06268a72cb';
const createdAt = new Date('2026-10-18T12:00:00Z');
const expiresAt = new Date('2026-10-25T12:00:00Z');
const input = {
  activityIds: ['123', '456'],
  expiresInMs: 604800000,
  fields: { showRouteEnds: false },
};
const created = {
  id,
  token: 'secret-capability',
  createdAt,
  expiresAt,
  fields: input.fields,
  activityIds: [123, 456],
};
function setup(
  overrides: Partial<Parameters<typeof createShareLinksHandler>[0]> = {},
) {
  const calls: unknown[] = [];
  const deps: Parameters<typeof createShareLinksHandler>[0] = {
    resolveActor: async () => actor,
    create: async (...args) => {
      calls.push(args);
      return created;
    },
    list: async (...args) => {
      calls.push(args);
      return [
        { ...created, activityCount: 2, revokedAt: null, status: 'active' },
      ];
    },
    revoke: async (...args) => {
      calls.push(args);
    },
    ...overrides,
  };
  return { deps, calls };
}
const request = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request('https://example.test/api/v1/share-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

void test('creation forwards only the authenticated actor and explicit validated scope; token returned once without caching', async () => {
  const { deps, calls } = setup();
  const response = await createShareLinksHandler(deps, 'create')(request());
  assert.equal(response.status, 201);
  assert.deepEqual(calls, [[actor, { ...input, activityIds: [123, 456] }]]);
  const body = (await response.json()) as { data: unknown };
  assert.deepEqual(body.data, {
    id,
    token: created.token,
    expiresAt: expiresAt.toISOString(),
  });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

void test('list excludes tokens and activity IDs; revocation receives the authenticated owner', async () => {
  const { deps, calls } = setup();
  const response = await createShareLinksHandler(
    deps,
    'list',
  )(new Request('https://example.test/api/v1/share-links'));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { links: unknown[] } };
  assert.deepEqual(body.data.links, [
    {
      id,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      fields: input.fields,
      activityCount: 2,
      status: 'active',
    },
  ]);
  const revoke = await createShareLinksHandler(deps, 'revoke')(request({ id }));
  assert.equal(revoke.status, 200);
  assert.deepEqual(calls, [[actor], [actor, id]]);
});

void test('all operations reject missing auth before touching services', async () => {
  const { deps, calls } = setup({ resolveActor: async () => null });
  for (const operation of ['create', 'list', 'revoke'] as const) {
    assert.equal(
      (await createShareLinksHandler(deps, operation)(request())).status,
      401,
    );
  }
  assert.deepEqual(calls, []);
});

void test('invalid bounds, unsafe IDs, extra fields and foreign origins never create links', async () => {
  const { deps, calls } = setup();
  const handler = createShareLinksHandler(deps, 'create');
  for (const body of [
    { ...input, activityIds: [] },
    { ...input, activityIds: Array(201).fill('123') },
    { ...input, activityIds: ['9007199254740993'] },
    { ...input, activityIds: ['1/2'] },
    { ...input, activityIds: [123] },
    { ...input, expiresInMs: 0 },
    { ...input, expiresInMs: 2592000001 },
    { ...input, fields: { heartRate: true } },
    { ...input, athleteId: 99 },
  ])
    assert.equal((await handler(request(body))).status, 400);
  assert.equal(
    (await handler(request(input, { Origin: 'https://other.test' }))).status,
    403,
  );
  const malformed = new Request('https://example.test/api/v1/share-links', {
    method: 'POST',
    body: '{',
  });
  assert.equal((await handler(malformed)).status, 400);
  assert.deepEqual(calls, []);
});

void test('ownership/not-found failures map to private errors; unexpected errors do not disclose tokens', async () => {
  const forbidden = setup({
    create: async () => {
      throw new ForbiddenError();
    },
  });
  assert.equal(
    (await createShareLinksHandler(forbidden.deps, 'create')(request())).status,
    403,
  );
  const missing = setup({
    revoke: async () => {
      throw new ShareLinkNotFoundError();
    },
  });
  assert.equal(
    (await createShareLinksHandler(missing.deps, 'revoke')(request({ id })))
      .status,
    404,
  );
  const failed = setup({
    create: async () => {
      throw new Error('secret-capability');
    },
  });
  const response = await createShareLinksHandler(
    failed.deps,
    'create',
  )(request());
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('secret-capability'));
});
