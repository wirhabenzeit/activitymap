import assert from 'node:assert/strict';

import test from 'node:test';

import fixtures from '../../../shared/sync-integrity-fixtures.v1.json';
import { convexPreviewFor } from './convex';

void test('bootstrap performs one scoped bridge call and validates returned ownership', async () => {
  const settings = {
    NODE_ENV: 'test',
    VERCEL_ENV: 'development',
    ACTIVITYMAP_CLIENT_BACKEND: 'convex-preview',
    ACTIVITYMAP_CONVEX_PREVIEW_OWNERS: JSON.stringify({
      owner: { epoch: 'test-epoch-123456789', key: 'a'.repeat(64) },
    }),
  };
  const previous = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, settings);
  try {
    const actor = {
      userId: 'owner',
      athleteId: 42,
      authentication: 'cookie' as const,
    };
    const operations: unknown[] = [];
    let athlete = '42';
    const preview = convexPreviewFor(actor, async (_input, init) => {
      assert.equal(typeof init?.body, 'string');
      const body = JSON.parse(init!.body as string) as {
        athleteId: number;
        epoch: string;
        operation: unknown;
      };
      assert.equal(body.athleteId, 42);
      assert.equal(body.epoch, 'test-epoch-123456789');
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
    });
    assert(preview);
    const result = await preview.bootstrapPage(actor, {
      resource: 'activities',
      limit: 500,
    });
    assert.deepEqual(operations, [
      { kind: 'bootstrap', resource: 'activities', after: null, limit: 500 },
    ]);
    assert.equal(result.sequence, 12);
    assert.equal(result.more, true);
    assert.equal(result.page.items.length, 1);
    await assert.rejects(
      preview.bootstrapPage(
        { ...actor, userId: 'other' },
        { resource: 'activities', limit: 100 },
      ),
      /actor mismatch/,
    );
    assert.equal(operations.length, 1);
    athlete = '999';
    await assert.rejects(
      preview.bootstrapPage(actor, { resource: 'activities', limit: 100 }),
      /scope mismatch/,
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
});
