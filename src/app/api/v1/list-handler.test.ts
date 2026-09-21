import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import type { Actor } from '~/server/auth/actor.ts';
import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import { paginatedSchema } from '~/contracts/v1/pagination.ts';
import { encodeBootstrapCursor } from '~/server/sync/bootstrap-cursor.ts';
import { createListHandler } from './list-handler.ts';

const ACTOR: Actor = {
  userId: 'user-1',
  athleteId: 42,
  authentication: 'cookie',
};
const NOW = new Date('2026-09-21T12:00:00.000Z');
const itemSchema = z.object({ id: z.string(), label: z.string() });
type Row = { id: number; athleteId: number; label: string };

function buildHandler({
  actor = ACTOR,
  rows = [] as Row[],
  onFindPage = () => undefined,
  onError = () => undefined,
}: {
  actor?: Actor | null;
  rows?: Row[];
  onFindPage?: () => void;
  onError?: (error: unknown, requestId: string) => void;
} = {}) {
  return createListHandler({
    createRequestId: () => 'request-1',
    now: () => NOW,
    resolveActor: async () => actor,
    itemSchema,
    findPage: async (
      athleteId,
      { afterKey = 0, limit }: { afterKey?: number; limit: number },
    ) => {
      onFindPage();
      return rows
        .filter((row) => row.athleteId === athleteId && row.id > afterKey)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
    },
    parseCursorKey: (key): number | null => {
      const parsed = Number(key);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    },
    cursorKeyFor: (row) => String(row.id),
    toItem: (row) => ({ id: String(row.id), label: row.label }),
    onError,
  });
}

void test('list handler rejects unauthenticated requests before querying the repository', async () => {
  let repositoryCalls = 0;
  const GET = buildHandler({
    actor: null,
    onFindPage: () => repositoryCalls++,
  });

  const response = await GET(new Request('https://example.test/api/v1/items'));
  const body: unknown = await response.json();

  assert.equal(response.status, 401);
  assert.equal(repositoryCalls, 0);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('list handler scopes rows to the actor and returns a stable keyset cursor', async () => {
  const GET = buildHandler({
    rows: [
      { id: 1, athleteId: ACTOR.athleteId, label: 'one' },
      { id: 2, athleteId: 999, label: 'other user' },
      { id: 3, athleteId: ACTOR.athleteId, label: 'three' },
      { id: 4, athleteId: ACTOR.athleteId, label: 'four' },
    ],
  });

  const first = await GET(
    new Request('https://example.test/api/v1/items?limit=2'),
  );
  const firstBody = (await first.json()) as {
    data: { items: { id: string }[]; nextCursor: string | null };
  };

  assert.equal(first.status, 200);
  assert.equal(
    responseEnvelope(paginatedSchema(itemSchema)).safeParse(firstBody).success,
    true,
  );
  assert.deepEqual(
    firstBody.data.items.map(({ id }) => id),
    ['1', '3'],
  );
  assert.ok(firstBody.data.nextCursor);

  const second = await GET(
    new Request(
      `https://example.test/api/v1/items?limit=2&cursor=${encodeURIComponent(firstBody.data.nextCursor)}`,
    ),
  );
  const secondBody = (await second.json()) as {
    data: { items: { id: string }[]; nextCursor: string | null };
  };
  assert.deepEqual(
    secondBody.data.items.map(({ id }) => id),
    ['4'],
  );
  assert.equal(secondBody.data.nextCursor, null);
});

void test('list handler returns null after an exactly-full final page', async () => {
  const GET = buildHandler({
    rows: [
      { id: 1, athleteId: ACTOR.athleteId, label: 'one' },
      { id: 2, athleteId: ACTOR.athleteId, label: 'two' },
    ],
  });

  const response = await GET(
    new Request('https://example.test/api/v1/items?limit=2'),
  );
  const body = (await response.json()) as {
    data: { nextCursor: string | null };
  };

  assert.equal(response.status, 200);
  assert.equal(body.data.nextCursor, null);
});

void test('list handler rejects malformed cursors and limits with the stable error envelope', async () => {
  const GET = buildHandler();

  for (const query of [
    'cursor=not-a-cursor',
    `cursor=${encodeURIComponent(encodeBootstrapCursor('not-a-number'))}`,
    'limit=0',
  ]) {
    const response = await GET(
      new Request(`https://example.test/api/v1/items?${query}`),
    );
    const body: unknown = await response.json();
    assert.equal(response.status, 400);
    assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
  }
});

void test('list handler reports repository failures with request correlation', async () => {
  const failure = new Error('database unavailable');
  let reported: { error: unknown; requestId: string } | undefined;
  const GET = createListHandler({
    createRequestId: () => 'request-1',
    resolveActor: async () => ACTOR,
    itemSchema,
    findPage: async () => {
      throw failure;
    },
    parseCursorKey: Number,
    cursorKeyFor: (row: Row) => String(row.id),
    toItem: (row: Row) => ({ id: String(row.id), label: row.label }),
    onError: (error, requestId) => {
      reported = { error, requestId };
    },
  });

  const response = await GET(new Request('https://example.test/api/v1/items'));
  const body = (await response.json()) as {
    error: { code: string; requestId: string; retryable: boolean };
  };

  assert.equal(response.status, 500);
  assert.deepEqual(reported, { error: failure, requestId: 'request-1' });
  assert.equal(body.error.code, 'internal_error');
  assert.equal(body.error.requestId, 'request-1');
  assert.equal(body.error.retryable, true);
});
