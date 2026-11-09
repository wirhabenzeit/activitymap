import assert from 'node:assert/strict';

import type { QueryClient } from '@tanstack/react-query';
import test from 'node:test';

import type { ActivityDTO } from '~/contracts/v1/activity';

import { registerLibrarySync, retireLibrarySync } from './library-sync';
import {
  type SignalledLiveStore,
  coordinatedLiveStore,
  observedLiveStore,
} from './live-store';
import type { V1ActivityStreamChange } from './v1-sync';

const scope = 'auth:user-a';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function innerStore(log: string[]): SignalledLiveStore {
  return {
    cursor: async () => {
      log.push('cursor');
      return { sequence: 7, version: 'v1' };
    },
    apply: async ({ upserts }) => {
      log.push(`apply ${upserts.length}`);
    },
    heldIds: async () => {
      log.push('heldIds');
      return [];
    },
  };
}

void test('a new session reads nothing before earlier cleanup of its account has run', async () => {
  const client = {} as QueryClient; // Only used as the registry key.
  const log: string[] = [];
  // A -> B: A's cleanup is queued and still running (e.g. draining a download).
  const cleanup = deferred();
  const retired = retireLibrarySync(client, scope, async () => {
    await cleanup.promise;
    log.push('erase A');
  });
  // B -> A: A's next session starts at once.
  const unregister = registerLibrarySync(client, scope, async () => undefined);
  const store = coordinatedLiveStore(client, scope, innerStore(log));
  const cursor = store.cursor();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(log, [], 'the stored position is not read yet');

  cleanup.resolve();
  assert.deepEqual(await cursor, { sequence: 7, version: 'v1' });
  await retired;
  assert.deepEqual(log, ['erase A', 'cursor']);
  unregister();
});

void test('a retired account writes nothing more', async () => {
  const client = {} as QueryClient; // Only used as the registry key.
  const log: string[] = [];
  registerLibrarySync(client, scope, async () => undefined);
  const store = coordinatedLiveStore(client, scope, innerStore(log));
  await store.apply({
    upserts: [],
    deletes: [],
    cursor: null,
    matchingVersion: 'm',
  });
  await retireLibrarySync(client, scope, async () => {
    log.push('erase A');
  });
  await assert.rejects(
    store.apply({
      upserts: [{ id: '1' } as never],
      deletes: [],
      cursor: null,
      matchingVersion: 'm',
    }),
  );
  assert.deepEqual(log, ['apply 0', 'erase A']);
});

void test('an operation resolves once its commit has run, before its pass ends', async () => {
  const client = {} as QueryClient; // Only used as the registry key.
  const log: string[] = [];
  const refresh = deferred();
  const unregister = registerLibrarySync(client, scope, () => refresh.promise);
  const store = coordinatedLiveStore(client, scope, innerStore(log));
  // Resolves while the writer's pass is still refreshing the snapshot.
  assert.deepEqual(await store.heldIds(), []);
  // The next operation is serialized behind that refresh.
  let applied = false;
  const apply = store
    .apply({ upserts: [], deletes: [], cursor: null, matchingVersion: 'm' })
    .then(() => {
      applied = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(applied, false);
  refresh.resolve();
  await apply;
  assert.deepEqual(log, ['heldIds', 'apply 0']);
  unregister();
});

void test('committed batches report their activities and stream metadata', async () => {
  const log: string[] = [];
  const seen: V1ActivityStreamChange[][] = [];
  const store = observedLiveStore(innerStore(log), (changes) => {
    log.push('observed');
    seen.push(changes);
  });
  const streams = { state: 'current', revision: '2' };
  const signal = new AbortController().signal;
  await store.apply(
    {
      upserts: [{ id: '1', streams }, { id: '2' }] as unknown as ActivityDTO[],
      deletes: ['3'],
      cursor: { sequence: 8, version: 'v1' },
      matchingVersion: 'm',
    },
    signal,
  );
  // Reported after the commit, like the REST sync's observations.
  assert.deepEqual(log, ['apply 2', 'observed']);
  assert.deepEqual(seen, [
    [
      { activityId: '1', operation: 'upsert', metadata: streams },
      { activityId: '2', operation: 'upsert', metadata: undefined },
      { activityId: '3', operation: 'delete' },
    ],
  ]);

  // A batch that only moves the position reports nothing.
  await store.apply(
    { upserts: [], deletes: [], cursor: null, matchingVersion: 'm' },
    signal,
  );
  assert.equal(seen.length, 1);
});

void test('a batch committed as the writer is fenced is not reported', async () => {
  const session = new AbortController();
  const seen: V1ActivityStreamChange[][] = [];
  const store = observedLiveStore(
    {
      ...innerStore([]),
      apply: async () => session.abort(),
    },
    (changes) => void seen.push(changes),
  );
  await assert.rejects(
    store.apply(
      {
        upserts: [{ id: '1' }] as unknown as ActivityDTO[],
        deletes: [],
        cursor: null,
        matchingVersion: 'm',
      },
      session.signal,
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(seen, []);
});
