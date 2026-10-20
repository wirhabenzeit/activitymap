import assert from 'node:assert/strict';

import test from 'node:test';

import {
  type ActivityCommandAuthState,
  ActivityCommandBusyError,
  type ActivityCommandSession,
  isActivityCommandSessionCurrent,
  isSilentActivityCommandError,
  runActivityCommand,
} from './activity-command-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function source() {
  let state: ActivityCommandAuthState = {
    authSession: 1,
    isGuest: false,
    user: { id: 'alice', stravaConnected: true },
  };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory subscribers
        listeners.delete(listener);
      };
    },
    transition: (next: Partial<ActivityCommandAuthState>) => {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscriptions: () => listeners.size,
  };
}

const alice: ActivityCommandSession = { userId: 'alice', generation: 1 };

void test('same-turn commands from independent consumers never overlap or queue stale drafts', async () => {
  const client = {};
  const auth = source();
  const response = deferred<string>();
  let requests = 0;
  const first = runActivityCommand(client, alice, 7, auth, async () => {
    requests++;
    return response.promise;
  });
  await assert.rejects(
    runActivityCommand(client, alice, 7, auth, async () => {
      requests++;
      return 'obsolete draft';
    }),
    ActivityCommandBusyError,
  );
  assert.equal(requests, 1);
  response.resolve('committed');
  assert.equal(await first, 'committed');
  assert.equal(
    await runActivityCommand(
      client,
      alice,
      7,
      auth,
      async () => 'next intentional edit',
    ),
    'next intentional edit',
  );
  assert.equal(
    requests,
    1,
    'The duplicate was rejected, not replayed after completion',
  );
  assert.equal(auth.subscriptions(), 0);
});

void test('different activities and isolated query clients can progress independently', async () => {
  const auth = source();
  const one = {},
    two = {};
  const held = deferred<string>();
  const first = runActivityCommand(one, alice, 7, auth, () => held.promise);
  assert.equal(
    await runActivityCommand(one, alice, 8, auth, async () => 'other activity'),
    'other activity',
  );
  assert.equal(
    await runActivityCommand(two, alice, 7, auth, async () => 'other app'),
    'other app',
  );
  held.resolve('finished');
  await first;
});

void test('submitted work keeps its own auth subscription and fences rapid account return', async () => {
  const auth = source();
  const client = {};
  const oldResponse = deferred<string>();
  let oldSignal: AbortSignal | undefined;
  const old = runActivityCommand(client, alice, 7, auth, (signal) => {
    oldSignal = signal;
    return oldResponse.promise;
  });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  assert.equal(
    auth.subscriptions(),
    1,
    'Command lifetime is independent of a mounted view',
  );
  auth.transition({
    authSession: 2,
    user: { id: 'bob', stravaConnected: true },
  });
  auth.transition({
    authSession: 3,
    user: { id: 'alice', stravaConnected: true },
  });
  assert.equal(oldSignal?.aborted, true);
  assert.equal(isActivityCommandSessionCurrent(alice, auth.getState()), false);
  await assert.rejects(
    runActivityCommand(client, alice, 7, auth, async () => 'stale cache retry'),
    { name: 'AbortError' },
  );
  const newResponse = deferred<string>();
  const nextSession = { userId: 'alice', generation: 3 };
  const current = runActivityCommand(
    client,
    nextSession,
    7,
    auth,
    () => newResponse.promise,
  );
  oldResponse.resolve('old remote response');
  await rejected;
  await assert.rejects(
    runActivityCommand(client, nextSession, 7, auth, async () => 'duplicate'),
    ActivityCommandBusyError,
  );
  newResponse.resolve('new response');
  assert.equal(await current, 'new response');
  assert.equal(auth.subscriptions(), 0);
});

void test('retirement while reconciliation awaits prevents later publication', async () => {
  const auth = source();
  const refreshed = deferred<undefined>();
  const effects: string[] = [];
  const pending = runActivityCommand({}, alice, 7, auth, async (signal) => {
    effects.push('committed before account change');
    await refreshed.promise;
    signal.throwIfAborted();
    effects.push('reset chart query');
  });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  auth.transition({ authSession: 2, user: undefined });
  refreshed.resolve(undefined);
  await rejected;
  assert.deepEqual(effects, ['committed before account change']);
});

void test('upstream failures release the command and disconnects cancel it without a failure notice', async () => {
  const auth = source();
  const client = {};
  await assert.rejects(
    runActivityCommand(client, alice, 7, auth, async () => {
      throw new Error('upstream failed');
    }),
    /upstream failed/,
  );
  const response = deferred<undefined>();
  const pending = runActivityCommand(
    client,
    alice,
    7,
    auth,
    () => response.promise,
  );
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  auth.transition({
    authSession: 2,
    user: { id: 'alice', stravaConnected: false },
  });
  response.resolve(undefined);
  await rejected;
  assert.equal(
    isSilentActivityCommandError(new DOMException('retired', 'AbortError')),
    true,
  );
  assert.equal(
    isSilentActivityCommandError(new ActivityCommandBusyError()),
    true,
  );
  assert.equal(
    isSilentActivityCommandError(new Error('remote failure')),
    false,
  );
  assert.equal(auth.subscriptions(), 0);
});
