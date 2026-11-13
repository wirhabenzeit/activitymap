import assert from 'node:assert/strict';

import test from 'node:test';

import type { Actor } from '~/server/auth/actor';
import type { ConvexWriter } from '~/server/sync/convex-writer';

import { startLibrary } from './index';
import { convexLiveUrlFor } from './live-configuration';

const actor: Actor = {
  userId: 'new-owner',
  athleteId: 42,
  authentication: 'bearer',
};
const state = {
  epoch: 'epoch-1234567890123456',
  writer: 'convex',
  writerEpoch: 1,
  revoked: false,
};
function scripted(steps: { kind: string; result?: unknown; error?: Error }[]) {
  const calls: { kind: string; [key: string]: unknown }[] = [];
  const writer: ConvexWriter = {
    async write<T>(operation: { kind: string; [key: string]: unknown }) {
      calls.push(operation);
      const step = steps.shift();
      assert.equal(operation.kind, step?.kind);
      if (step?.error) throw step.error;
      return step?.result as T;
    },
  };
  return { writer, calls };
}

void test('first discovery returns native configuration only after library and sign-in assignment are saved', async () => {
  const { writer, calls } = scripted([
    { kind: 'state', result: null },
    { kind: 'latestCatalogue', result: null },
    { kind: 'provision', result: 'owner-id' },
    { kind: 'state', result: { ...state, writer: 'postgres', writerEpoch: 0 } },
    { kind: 'setWriter', result: 1 },
  ]);
  const events: string[] = [];
  const url = await convexLiveUrlFor(
    {
      id: actor.userId,
      athlete_id: actor.athleteId,
      writer: 'postgres',
      convexEpoch: null,
    },
    {
      authentication: 'bearer',
      environment: {
        ACTIVITYMAP_CONVEX_URL: 'https://example.convex.cloud',
        ACTIVITYMAP_AUTH_JWT_ISSUER: 'https://app.example.test',
      },
      start: (candidate) =>
        startLibrary(candidate, {
          writer,
          recordAssignment: async (userId, assignment) => {
            assert.equal(userId, actor.userId);
            assert.deepEqual(assignment, {
              writer: 'convex',
              convexEpoch: state.epoch,
            });
            events.push('assignment-saved');
          },
        }),
    },
  );
  events.push('configuration-returned');
  assert.equal(url, 'https://example.convex.cloud');
  assert.deepEqual(events, ['assignment-saved', 'configuration-returned']);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ['state', 'latestCatalogue', 'provision', 'state', 'setWriter'],
  );
});

void test('a library read cannot complete a handoff or revive a revoked owner', async () => {
  for (const current of [
    { ...state, writer: 'handoff' },
    { ...state, revoked: true },
  ]) {
    const { writer, calls } = scripted([{ kind: 'state', result: current }]);
    await assert.rejects(
      startLibrary(actor, {
        writer,
        recordAssignment: async () => {
          assert.fail('Must not change sign-in assignment');
        },
      }),
      /unavailable/,
    );
    assert.equal(calls.length, 1);
  }
});

void test('a writer handoff racing initialization is not recorded as successful', async () => {
  const { writer } = scripted([
    { kind: 'state', result: { ...state, writer: 'postgres', writerEpoch: 0 } },
    { kind: 'setWriter', result: null },
  ]);
  await assert.rejects(
    startLibrary(actor, {
      writer,
      recordAssignment: async () => {
        assert.fail('Must not record a lost writer comparison');
      },
    }),
    /assignment changed/,
  );
});

void test('concurrent provisioning can use the owner that won, without replacing its assignment', async () => {
  const { writer, calls } = scripted([
    { kind: 'state', result: null },
    { kind: 'latestCatalogue', result: null },
    { kind: 'provision', error: new Error('Concurrent owner assignment') },
    { kind: 'state', result: state },
  ]);
  assert.equal(
    await startLibrary(actor, {
      writer,
      recordAssignment: async () => undefined,
    }),
    state.epoch,
  );
  assert.equal(calls.filter((call) => call.kind === 'setWriter').length, 0);
});
