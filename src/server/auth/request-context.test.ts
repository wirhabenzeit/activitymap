import assert from 'node:assert/strict';

import test from 'node:test';

import { createAuthenticatedRequestContext } from './request-context';

const policy = { route: 'GET /test', cache: 'private-no-store' } as const;

void test('concurrent session, user and actor consumers resolve each dependency once per request', async () => {
  let sessions = 0;
  let actors = 0;
  const context = createAuthenticatedRequestContext(
    new Request('https://app.test', {
      headers: { 'x-request-id': 'client-id' },
    }),
    policy,
    {
      resolveSession: async () => {
        sessions++;
        return { user: { id: 'owner' } };
      },
      resolveActor: async (_headers, session) => {
        actors++;
        return {
          userId: session.user.id,
          athleteId: 42,
          authentication: 'cookie',
        };
      },
    },
  );
  const [session, userId, actor, again] = await Promise.all([
    context.session(),
    context.userId(),
    context.actor(),
    context.actor(),
  ]);
  assert.equal(context.requestId, 'client-id');
  assert.equal(context.policy, policy);
  assert.equal(session.user.id, userId);
  assert.equal(actor, again);
  assert.equal(sessions, 1);
  assert.equal(actors, 1);
});

void test('rejected resolutions are shared within a request and never reused across requests or accounts', async () => {
  let sessions = 0;
  let actors = 0;
  const deps = {
    resolveSession: async (headers: Headers) => {
      sessions++;
      if (headers.get('authorization') === 'broken')
        throw new Error('session unavailable');
      return { user: { id: headers.get('authorization')! } };
    },
    resolveActor: async () => {
      actors++;
      throw new Error('user unavailable');
    },
  };
  const make = (user: string) =>
    createAuthenticatedRequestContext(
      new Request('https://app.test', { headers: { authorization: user } }),
      policy,
      deps,
    );
  const broken = make('broken');
  const failed = await Promise.allSettled([
    broken.session(),
    broken.userId(),
    broken.actor(),
    broken.actor(),
  ]);
  assert.ok(failed.every((result) => result.status === 'rejected'));
  assert.equal(sessions, 1);
  assert.equal(actors, 0);
  const first = make('first');
  const second = make('second');
  assert.deepEqual(await Promise.all([first.userId(), second.userId()]), [
    'first',
    'second',
  ]);
  assert.equal(sessions, 3);
  await Promise.allSettled([first.actor(), first.actor()]);
  assert.equal(actors, 1);
  await Promise.allSettled([second.actor()]);
  assert.equal(actors, 2);
});
