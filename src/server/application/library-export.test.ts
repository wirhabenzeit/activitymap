import assert from 'node:assert/strict';

import test from 'node:test';

import type { ActivityDTO } from '~/contracts/v1/activity';
import type { Actor } from '~/server/auth/actor';

import { libraryFromConvex } from './library-export';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'cookie',
  convexWrites: true,
};
const item = (id: string) =>
  ({ id, start_date_local: '2026-11-01T09:00:00.000Z' }) as ActivityDTO;

void test('the export reads every page, continuing after the last activity', async () => {
  const pages: Record<string, { ids: string[]; more: boolean }> = {
    start: { ids: ['1', '2'], more: true },
    '2': { ids: ['3'], more: true },
    '3': { ids: [], more: false },
  };
  const asked: (string | undefined)[] = [];
  const rows = await libraryFromConvex(
    {
      bootstrapPage: async (_actor, { afterKey }) => {
        asked.push(afterKey);
        const { ids, more } = pages[afterKey ?? 'start']!;
        return { more, page: { resource: 'activities', items: ids.map(item) } };
      },
    },
    actor,
  );
  assert.deepEqual(asked, [undefined, '2', '3']);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['1', '2', '3'],
  );
  assert(rows[0]!.start_date_local instanceof Date);
  assert.equal(
    rows[0]!.start_date_local.toISOString(),
    '2026-11-01T09:00:00.000Z',
  );
});

void test('an export that stops advancing ends instead of repeating', async () => {
  let calls = 0;
  const rows = await libraryFromConvex(
    {
      bootstrapPage: async () => {
        calls++;
        return {
          more: true,
          page: { resource: 'activities', items: [item('1')] },
        };
      },
    },
    actor,
  );
  assert.equal(calls, 2);
  assert.equal(rows.length, 2);
});
