import assert from 'node:assert/strict';

import test from 'node:test';

import type { Actor } from '~/server/auth/actor';
import { ActivityStreamsUnavailableError } from '~/server/repositories/activity-streams';

import { authorizedStreams } from './authorized-streams';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'bearer',
};
const row = (activityId: string) => ({ activityId, row: null }) as never;

function harness(readable: (ids: string[]) => Promise<Set<string>>) {
  const order: string[] = [];
  const streams = authorizedStreams(
    {
      read: (async (_actor: Actor, id: string) => {
        order.push('copy');
        return { activityId: id, payload: {} };
      }) as never,
      readSummaries: async (_actor: Actor, ids: string[]) => {
        order.push('copy');
        return ids.map(row);
      },
    },
    {
      readable: async (_actor, ids) => {
        order.push('authority');
        return readable(ids);
      },
    },
  );
  return { streams, order };
}

void test('the copy is released only for activities the authority allows', async () => {
  const { streams, order } = harness(async () => new Set(['1', '3']));
  assert.deepEqual(
    (await streams.readSummaries(actor, ['1', '2', '3'])).map(
      (read) => read.activityId,
    ),
    ['1', '3'],
  );
  assert.equal((await streams.read(actor, '1'))?.activityId, '1');
  // Deleted in Postgres, still held by the copy.
  await assert.rejects(
    streams.read(actor, '2'),
    ActivityStreamsUnavailableError,
  );
  // Access is checked after the copy is read, never before.
  assert.deepEqual(order, [
    'copy',
    'authority',
    'copy',
    'authority',
    'copy',
    'authority',
  ]);
});

void test('a revoked account gets nothing from the copy', async () => {
  const { streams } = harness(async () => {
    throw new ActivityStreamsUnavailableError();
  });
  await assert.rejects(
    streams.read(actor, '1'),
    ActivityStreamsUnavailableError,
  );
  await assert.rejects(
    streams.readSummaries(actor, ['1']),
    ActivityStreamsUnavailableError,
  );
});
