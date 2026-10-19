import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import type * as ReactQuery from '@tanstack/react-query';
import test from 'node:test';

import { activityDTOSchema } from '~/contracts/v1/activity';
import { photoDTOSchema } from '~/contracts/v1/photo';

import gallery from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
import {
  LibraryOwner,
  type LibraryOwnerStore,
  authenticatedLibraryScope,
  disposeLibraryScope,
  getLibraryOwner,
  libraryQueryKeys,
} from './library-owner';
import {
  type V1LibraryCommit,
  type V1LibrarySnapshot,
  type V1SyncState,
  readV1LibrarySnapshot,
} from './v1-store';

// Keep these owner tests framework-neutral under the react-server test condition.
const require = createRequire(import.meta.url);
const core = require.resolve('@tanstack/query-core', {
  paths: [dirname(require.resolve('@tanstack/react-query/package.json'))],
});
const { QueryClient } = (await import(pathToFileURL(core).href)) as Pick<
  typeof ReactQuery,
  'QueryClient'
>;
const scope = authenticatedLibraryScope('library-test');
const defaults = Object.fromEntries(
  Object.keys(activityDTOSchema.shape)
    .filter((key) => key !== 'streams')
    .map((key) => [key, null]),
);
const activity = activityDTOSchema.parse({
  ...defaults,
  ...gallery.activities[0],
  id: '1',
  name: 'Cached ride',
});
const photo = photoDTOSchema.parse({
  ...Object.fromEntries(
    Object.keys(photoDTOSchema.shape).map((key) => [key, null]),
  ),
  unique_id: 'photo-1',
  activity_id: '1',
  athlete_id: '42',
  type: 1,
});
function checkpoint(complete = true): V1SyncState {
  return {
    scope,
    bootstrapCursor: 'snapshot',
    changesCursor: complete ? 'cursor' : null,
    bootstrapComplete: complete,
    lastSyncAt: complete ? '2026-10-19T00:00:00.000Z' : null,
    updatedAt: '2026-10-19T00:00:00.000Z',
  };
}
function empty(): V1LibrarySnapshot {
  return { activities: [], photos: [], syncState: null };
}
function completed(): V1LibrarySnapshot {
  return { activities: [activity], photos: [photo], syncState: checkpoint() };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class Store implements LibraryOwnerStore {
  data = empty();
  reads = 0;
  gate: ReturnType<typeof deferred> | undefined;
  failure: Error | undefined;
  signal: AbortSignal | undefined;
  listeners = new Set<(commit: V1LibraryCommit) => void>();
  readV1LibrarySnapshot = async (_scope: string, signal?: AbortSignal) => {
    this.reads++;
    this.signal = signal;
    const captured = structuredClone(this.data);
    const gate = this.gate;
    this.gate = undefined;
    if (gate) await gate.promise; // Deliberately ignores cancellation: owner must fence late reads.
    if (this.failure) throw this.failure;
    return captured;
  };
  subscribeV1LibraryCommits = (listener: (commit: V1LibraryCommit) => void) => {
    this.listeners.add(listener);
    return () => {
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Set
      this.listeners.delete(listener);
    };
  };
  commit(
    data: V1LibrarySnapshot,
    kind: V1LibraryCommit['kind'] = 'write',
    owner = scope,
  ) {
    this.data = data;
    for (const listener of this.listeners)
      listener({ scope: owner, revision: 1, kind });
  }
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert(check(), 'Expected owner work did not settle');
}

void test('cache hydration distinguishes no snapshot, partial rows/checkpoint, and complete empty library', async (t) => {
  const cases: Array<[V1LibrarySnapshot, string]> = [
    [empty(), 'unloaded'],
    [{ ...empty(), activities: [activity] }, 'partial'],
    [{ ...empty(), syncState: checkpoint(false) }, 'partial'],
    [{ ...empty(), syncState: checkpoint() }, 'complete'],
  ];
  for (const [data, expected] of cases) {
    const client = new QueryClient();
    const store = new Store();
    store.data = data;
    const owner = new LibraryOwner(client, scope, store);
    t.after(() => {
      owner.dispose();
      client.clear();
    });
    const server = owner.getServerSnapshot();
    assert.equal(
      store.listeners.size,
      0,
      'Constructing/reading an SSR owner does not retain a global subscription',
    );
    assert.equal(owner.getSnapshot().loaded, false);
    owner.retain();
    await Promise.all([owner.load(), owner.load(), owner.load()]);
    assert.equal(store.reads, 1, 'All consumers share one hydration read');
    assert.equal(owner.getSnapshot().loaded, true);
    assert.equal(owner.getSnapshot().completeness, expected);
    assert.strictEqual(
      client.getQueryData(libraryQueryKeys.snapshot(scope)),
      owner.getSnapshot(),
    );
    assert.strictEqual(owner.getServerSnapshot(), server);
    assert.equal(server.loaded, false);
    assert.equal(
      server.activities.length,
      0,
      'SSR never sees the hydrated authenticated library',
    );
    await owner.load();
    assert.equal(
      store.reads,
      1,
      'Cached reopen is a read, not another download/hydration',
    );
  }
});

void test('committed activity/photo changes publish together with one revision and preserve unchanged DTO arrays', async (t) => {
  const client = new QueryClient();
  const store = new Store();
  store.data = completed();
  const owner = new LibraryOwner(client, scope, store);
  t.after(() => {
    owner.dispose();
    client.clear();
  });
  owner.retain();
  await owner.load();
  const initial = owner.getSnapshot();
  await owner.refresh();
  assert.strictEqual(owner.getSnapshot().activities, initial.activities);
  assert.strictEqual(owner.getSnapshot().photos, initial.photos);
  const observed: string[] = [];
  owner.subscribe(() => {
    const snapshot = owner.getSnapshot();
    observed.push(
      `${snapshot.activities[0]?.name}:${snapshot.photos[0]?.caption}`,
    );
  });
  store.commit({
    activities: [{ ...activity, name: 'Updated ride' }],
    photos: [{ ...photo, caption: 'Updated photo' }],
    syncState: checkpoint(),
  });
  await until(() => owner.getSnapshot().activities[0]?.name === 'Updated ride');
  assert.deepEqual(observed, ['Updated ride:Updated photo']);
  assert.equal(owner.getSnapshot().revision, initial.revision + 2);
});

void test('a commit during hydration fences the captured old read and coalesces later commits', async (t) => {
  const client = new QueryClient();
  const store = new Store();
  store.data = completed();
  const gate = deferred();
  store.gate = gate;
  const owner = new LibraryOwner(client, scope, store);
  t.after(() => {
    owner.dispose();
    client.clear();
  });
  const observations: string[] = [];
  owner.subscribe(() =>
    observations.push(owner.getSnapshot().activities[0]?.name ?? 'empty'),
  );
  const pending = owner.load();
  await until(() => store.reads === 1);
  store.commit({
    ...completed(),
    activities: [{ ...activity, name: 'Intermediate' }],
  });
  store.commit({
    ...completed(),
    activities: [{ ...activity, name: 'Newest' }],
  });
  gate.resolve();
  await pending;
  assert.equal(store.reads, 2);
  assert.deepEqual(observations, ['Newest']);
});

void test('clear invalidation immediately clears projections and prevents an old pending read from resurrecting them', async (t) => {
  const client = new QueryClient();
  const store = new Store();
  store.data = completed();
  const owner = new LibraryOwner(client, scope, store);
  t.after(() => {
    owner.dispose();
    client.clear();
  });
  await owner.load();
  const gate = deferred();
  store.gate = gate;
  const pending = owner.refresh();
  await until(() => store.reads === 2);
  store.commit(empty(), 'clear');
  assert.equal(owner.getSnapshot().activities.length, 0);
  assert.equal(owner.getSnapshot().photos.length, 0);
  assert.equal(owner.getSnapshot().completeness, 'unloaded');
  gate.resolve();
  await pending;
  assert.equal(owner.getSnapshot().activities.length, 0);
  assert.equal(owner.getSnapshot().completeness, 'unloaded');
});

void test('disposing aborts and fences late reads, removes the query, and isolates other scopes', async () => {
  const client = new QueryClient();
  const store = new Store();
  store.data = completed();
  const gate = deferred();
  store.gate = gate;
  const owner = new LibraryOwner(client, scope, store);
  const otherKey = libraryQueryKeys.snapshot('auth:other');
  client.setQueryData(otherKey, 'other account');
  const pending = owner.load();
  await until(() => store.reads === 1);
  owner.dispose();
  assert.equal(store.signal?.aborted, true);
  assert.equal(store.listeners.size, 0);
  assert.equal(owner.getSnapshot().loaded, false);
  assert.equal(
    client.getQueryData(libraryQueryKeys.snapshot(scope)),
    undefined,
  );
  assert.equal(client.getQueryData(otherKey), 'other account');
  gate.resolve();
  await pending;
  store.commit(completed());
  assert.equal(owner.getSnapshot().activities.length, 0);
  assert.equal(
    client.getQueryData(libraryQueryKeys.snapshot(scope)),
    undefined,
  );
  client.clear();
});

void test('cache read failure preserves the last completed snapshot and retry publishes fresh data', async (t) => {
  const client = new QueryClient();
  const store = new Store();
  store.data = completed();
  const owner = new LibraryOwner(client, scope, store);
  t.after(() => {
    owner.dispose();
    client.clear();
  });
  await owner.load();
  const previous = owner.getSnapshot();
  store.failure = new Error('Disk read failed');
  await assert.rejects(owner.refresh(), /Disk read failed/);
  assert.strictEqual(owner.getSnapshot().activities, previous.activities);
  assert.equal(owner.getSnapshot().completeness, 'complete');
  assert.equal(owner.getSnapshot().error, store.failure);
  store.failure = undefined;
  store.data = {
    ...completed(),
    activities: [{ ...activity, name: 'Retried' }],
  };
  await owner.refresh();
  assert.equal(owner.getSnapshot().error, null);
  assert.equal(owner.getSnapshot().activities[0]?.name, 'Retried');
});

void test('unavailable storage reports an explicit error, never a successful empty library', async () => {
  await assert.rejects(
    readV1LibrarySnapshot(scope),
    /IndexedDB is unavailable/,
  );
  const client = new QueryClient();
  const owner = getLibraryOwner(client, scope);
  await assert.rejects(owner.load(), /IndexedDB is unavailable/);
  assert.equal(owner.getSnapshot().loaded, false);
  assert.equal(owner.getSnapshot().completeness, 'unloaded');
  assert.match(
    owner.getSnapshot().error?.message ?? '',
    /IndexedDB is unavailable/,
  );
  disposeLibraryScope(client, scope);
  client.clear();
});

void test('owner registry is shared only within the same QueryClient and exact scope', () => {
  const first = new QueryClient(),
    second = new QueryClient();
  const owner = getLibraryOwner(first, scope);
  assert.strictEqual(getLibraryOwner(first, scope), owner);
  assert.notStrictEqual(getLibraryOwner(second, scope), owner);
  assert.notStrictEqual(
    getLibraryOwner(first, 'deployment-b:auth:library-test'),
    owner,
  );
  disposeLibraryScope(first, scope);
  assert.notStrictEqual(getLibraryOwner(first, scope), owner);
  disposeLibraryScope(first, scope);
  disposeLibraryScope(second, scope);
  disposeLibraryScope(first, 'deployment-b:auth:library-test');
  first.clear();
  second.clear();
});

void test('provider/view leases detach on unmount, preserve the cache, and refresh missed commits on reuse', async (t) => {
  const client = new QueryClient();
  const store = new Store();
  store.data = completed();
  const owner = new LibraryOwner(client, scope, store);
  t.after(() => {
    owner.dispose();
    client.clear();
  });
  const releaseProvider = owner.retain();
  const releaseView = owner.subscribe(() => {
    /* Mounted consumer. */
  });
  await owner.load();
  const cached = owner.getSnapshot();
  assert.equal(store.listeners.size, 1);
  releaseView();
  assert.equal(store.listeners.size, 1, 'Provider still owns the subscription');
  releaseProvider();
  releaseProvider();
  assert.equal(
    store.listeners.size,
    0,
    'No global listener retains an unused client',
  );
  assert.strictEqual(owner.getSnapshot(), cached);
  assert.strictEqual(
    client.getQueryData(libraryQueryKeys.snapshot(scope)),
    cached,
  );
  store.commit({
    ...completed(),
    activities: [{ ...activity, name: 'While away' }],
  });
  assert.strictEqual(owner.getSnapshot(), cached);
  const releaseRemount = owner.retain();
  assert.strictEqual(
    owner.getSnapshot(),
    cached,
    'Remount retains the visible cache',
  );
  await owner.load();
  assert.equal(owner.getSnapshot().activities[0]?.name, 'While away');
  assert.equal(store.listeners.size, 1);
  releaseRemount();
  assert.equal(store.listeners.size, 0);
});

void test('one-shot reads release external listeners and later loads reconcile missed commits', async (t) => {
  const client = new QueryClient();
  const store = new Store();
  store.data = completed();
  const owner = new LibraryOwner(client, scope, store);
  t.after(() => {
    owner.dispose();
    client.clear();
  });
  await owner.load();
  assert.equal(store.listeners.size, 0);
  store.commit({
    ...completed(),
    activities: [{ ...activity, name: 'After read' }],
  });
  await owner.load();
  assert.equal(owner.getSnapshot().activities[0]?.name, 'After read');
  assert.equal(store.listeners.size, 0);
  assert.equal(
    store.reads,
    2,
    'Temporary read leases do not start hydration loops',
  );
});
