import assert from 'node:assert/strict';

import test from 'node:test';

import type { Actor } from '~/server/auth/actor';

import { convexLiveUrlFor } from './live-configuration';

const url = 'https://example-123.convex.cloud';
const environment = {
  ACTIVITYMAP_CONVEX_URL: url,
  ACTIVITYMAP_AUTH_JWT_ISSUER: 'https://app.example.test',
};
const assigned = {
  id: 'owner',
  athlete_id: 42,
  writer: 'convex',
  convexEpoch: 'epoch-0123456789ab',
};
const neverStart = async () => {
  throw new Error('Unexpected library initialization');
};

void test('assigned accounts advertise live sync without provisioning again', async () => {
  assert.equal(
    await convexLiveUrlFor(assigned, { environment, start: neverStart }),
    url,
  );
});

void test('both clients start an uninitialized account before selecting live sync', async () => {
  for (const authentication of ['cookie', 'bearer'] as const) {
    for (const user of [
      { ...assigned, writer: 'postgres', convexEpoch: null },
      { ...assigned, convexEpoch: null },
    ]) {
      const starts: Actor[] = [];
      const value = await convexLiveUrlFor(user, {
        environment,
        authentication,
        start: async (actor) => {
          starts.push(actor);
          return assigned.convexEpoch;
        },
      });
      assert.equal(value, url);
      assert.deepEqual(starts, [
        { userId: 'owner', athleteId: 42, authentication },
      ]);
    }
  }
});

void test('handoff or unlinked accounts never have their writer changed by discovery', async () => {
  for (const user of [
    { ...assigned, writer: 'handoff' },
    { ...assigned, writer: 'handoff', convexEpoch: null },
    { ...assigned, athlete_id: null },
  ])
    assert.equal(
      await convexLiveUrlFor(user, { environment, start: neverStart }),
      null,
    );
});

void test('missing JWT or unsafe deployment configuration does not provision a library', async () => {
  assert.equal(
    await convexLiveUrlFor(assigned, { environment: {}, start: neverStart }),
    null,
  );
  assert.equal(
    await convexLiveUrlFor(assigned, {
      environment: { ACTIVITYMAP_CONVEX_URL: url },
      start: neverStart,
    }),
    null,
  );
  for (const value of [
    'http://example.convex.cloud',
    'https://user:secret@example.convex.cloud',
    'https://example.convex.cloud/path',
    'https://example.convex.cloud?key=secret',
    'invalid',
  ])
    assert.equal(
      await convexLiveUrlFor(assigned, {
        environment: { ...environment, ACTIVITYMAP_CONVEX_URL: value },
        start: neverStart,
      }),
      null,
    );
});

void test('a failed first-use initialization cannot advertise a ready native/web connection', async () => {
  await assert.rejects(
    convexLiveUrlFor(
      { ...assigned, convexEpoch: null },
      {
        environment,
        start: async () => {
          throw new Error('Bridge unavailable');
        },
      },
    ),
    /Bridge unavailable/,
  );
});
