import assert from 'node:assert/strict';

import test from 'node:test';

import fixtures from '../../../shared/sync-integrity-fixtures.v1.json';
import { BridgeResponseError } from '../sync/bridge-response-error';
import { SyncRebootstrapRequiredError } from '../sync/errors';
import { convexAppAdapter } from './convex';

void test('delta compatibility distinguishes an old backend from auth, cursor and server failures', async (t) => {
  for (const [name, value] of Object.entries({
    ACTIVITYMAP_CONVEX_SITE: 'https://backend.example.com',
    ACTIVITYMAP_CONVEX_KEY_ID: 'current',
    ACTIVITYMAP_CONVEX_SIGNING_KEY: 'a'.repeat(64),
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = previous;
    });
  }
  const actor = {
    userId: 'owner',
    athleteId: 42,
    authentication: 'bearer' as const,
  };
  for (const status of [400, 401, 403, 409, 429, 500, 503]) {
    let calls = 0;
    const adapter = convexAppAdapter(
      actor,
      'epoch-1234567890123456',
      async () => {
        calls++;
        return new Response(null, { status });
      },
    );
    const result = adapter.changesPage(actor, { after: 0, limit: 500 });
    if (status === 400) assert.equal(await result, null);
    else
      await assert.rejects(
        result,
        (error: unknown) =>
          error instanceof BridgeResponseError && error.status === status,
      );
    assert.equal(calls, 1);
  }
  const expired = convexAppAdapter(actor, 'epoch-1234567890123456', async () =>
    Response.json({ code: 'sync_rebootstrap_required' }, { status: 409 }),
  );
  await assert.rejects(
    expired.changesPage(actor, { after: 0, limit: 500 }),
    SyncRebootstrapRequiredError,
  );
  const malformed = convexAppAdapter(
    actor,
    'epoch-1234567890123456',
    async () => Response.json({}),
  );
  await assert.rejects(malformed.changesPage(actor, { after: 0, limit: 500 }));
  const unavailable = convexAppAdapter(
    actor,
    'epoch-1234567890123456',
    async () => {
      throw new TypeError('network unavailable');
    },
  );
  await assert.rejects(
    unavailable.changesPage(actor, { after: 0, limit: 500 }),
    /network unavailable/,
  );
});

void test('production delta returns current DTOs with one bridge call and rejects foreign projections', async (t) => {
  const settings = {
    ACTIVITYMAP_CONVEX_SITE: 'https://backend.example.com',
    ACTIVITYMAP_CONVEX_KEY_ID: 'current',
    ACTIVITYMAP_CONVEX_SIGNING_KEY: 'a'.repeat(64),
  };
  for (const [name, value] of Object.entries(settings)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = previous;
    });
  }
  const actor = {
    userId: 'owner',
    athleteId: 42,
    authentication: 'bearer' as const,
  };
  const operations: unknown[] = [];
  let athlete = '42';
  const adapter = convexAppAdapter(
    actor,
    'epoch-1234567890123456',
    async (_url, init) => {
      assert.equal(typeof init?.body, 'string');
      operations.push(
        (JSON.parse(init!.body as string) as { operation: unknown }).operation,
      );
      return Response.json({
        head: {
          sequence: 12,
          matchingVersion: 'b'.repeat(64),
          lastSummaryReconciledAt: null,
        },
        items: [
          {
            sequence: '12',
            entityType: 'activity',
            operation: 'upsert',
            id: fixtures.activity.id,
            activity: {
              ...fixtures.activity,
              athlete,
              placeMatches: undefined,
            },
          },
        ],
        lastSequence: 12,
      });
    },
  );
  assert(adapter.changesPage);
  const page = await adapter.changesPage(actor, { after: 11, limit: 500 });
  assert(page);
  assert.deepEqual(operations, [
    { kind: 'changesPage', after: 11, limit: 500 },
  ]);
  assert.equal(page.items[0]!.activity!.id, fixtures.activity.id);
  assert.equal(
    page.items[0]!.activity!.placeMatches!.matchingVersion,
    'b'.repeat(64),
  );
  athlete = '7';
  await assert.rejects(
    adapter.changesPage(actor, { after: 11, limit: 500 }),
    /scope mismatch/,
  );
});

void test('application bootstrap keeps cursor scope and validates request/response ownership', async (t) => {
  for (const [key, value] of Object.entries({
    ACTIVITYMAP_CONVEX_SITE: 'https://backend.example.com',
    ACTIVITYMAP_CONVEX_KEY_ID: 'k1',
    ACTIVITYMAP_CONVEX_SIGNING_KEY: 'a'.repeat(64),
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = previous;
    });
  }
  const actor = {
    userId: 'owner',
    athleteId: 42,
    authentication: 'bearer' as const,
  };
  const epoch = 'epoch-1234567890123456';
  const operations: unknown[] = [];
  let athlete = '42';
  const fetcher: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    assert.equal(url, 'https://backend.example.com/internal/sync/v1');
    const body = JSON.parse(init!.body as string) as {
      athleteId: string;
      epoch: string;
      operation: unknown;
    };
    assert.equal(body.athleteId, '42');
    assert.equal(body.epoch, epoch);
    operations.push(body.operation);
    return Response.json({
      resource: 'activities',
      more: true,
      head: {
        sequence: 12,
        lastSummaryReconciledAt: null,
        matchingVersion: 'b'.repeat(64),
      },
      items: [
        {
          ...fixtures.activity,
          id: '1',
          athlete,
          streams: undefined,
          placeMatches: undefined,
        },
      ],
    });
  };
  const library = convexAppAdapter(actor, epoch, fetcher);
  // Captured before removing migration routing: existing clients keep their
  // opaque HTTP cursor scope and do not download their libraries again.
  assert.equal(
    library.cursorBackend,
    '4a53612041270ea58af39fa16d3774075a71bee60a4230be26321b4ab9e64a21',
  );
  const result = await library.bootstrapPage(actor, {
    resource: 'activities',
    limit: 500,
  });
  assert.equal(result.sequence, 12);
  assert.equal(result.more, true);
  assert.equal(result.page.items.length, 1);
  assert.deepEqual(operations, [
    { kind: 'bootstrap', resource: 'activities', after: null, limit: 500 },
  ]);
  await assert.rejects(
    library.bootstrapPage(
      { ...actor, userId: 'other' },
      { resource: 'activities', limit: 100 },
    ),
    /actor mismatch/,
  );
  assert.equal(operations.length, 1);
  assert.notEqual(
    convexAppAdapter(actor, 'next-epoch-1234567890123456').cursorBackend,
    library.cursorBackend,
  );
  assert.notEqual(
    convexAppAdapter({ ...actor, userId: 'other' }, epoch).cursorBackend,
    library.cursorBackend,
  );
  process.env.ACTIVITYMAP_CONVEX_SITE = 'https://another-backend.example.com';
  assert.notEqual(
    convexAppAdapter(actor, epoch).cursorBackend,
    library.cursorBackend,
  );
  process.env.ACTIVITYMAP_CONVEX_SITE = 'https://backend.example.com';
  athlete = '999';
  await assert.rejects(
    library.bootstrapPage(actor, { resource: 'activities', limit: 100 }),
    /scope mismatch/,
  );
});
