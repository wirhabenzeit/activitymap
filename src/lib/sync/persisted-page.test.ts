import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import type * as ReactQuery from '@tanstack/react-query';

import { fetchAndPersistPage } from './persisted-page';

// Use the framework-neutral core under the test runner's react-server condition.
const require = createRequire(import.meta.url);
const queryCoreEntry = require.resolve('@tanstack/query-core', {
  paths: [dirname(require.resolve('@tanstack/react-query/package.json'))],
});
const { QueryClient, InfiniteQueryObserver } = (await import(
  pathToFileURL(queryCoreEntry).href
)) as Pick<typeof ReactQuery, 'QueryClient' | 'InfiniteQueryObserver'>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

void test('multiple consumers and navigation persist each fetched page once', async () => {
  const client = new QueryClient();
  const writeStarted = deferred();
  const finishWrite = deferred();
  const offsets: number[] = [];
  const writes: number[][] = [];
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const options = {
    queryKey: ['activities', 'auth', 'athlete-a'],
    queryFn: ({ pageParam }: { pageParam: number }) => fetchAndPersistPage({
      fetchPage: async () => {
        offsets.push(pageParam);
        return rows.slice(pageParam, pageParam + 2);
      },
      persistPage: async (page) => {
        writes.push(page.map((row) => row.id));
        if (writes.length === 1) {
          writeStarted.resolve();
          await finishWrite.promise;
        }
      },
      onPersistenceError: (error: unknown) => assert.fail(String(error)),
    }),
    initialPageParam: 0,
    getNextPageParam: (last: typeof rows, pages: typeof rows[]) =>
      last.length === 2 ? pages.length * 2 : undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
  };
  const streamer = new InfiniteQueryObserver(client, options);
  const map = new InfiniteQueryObserver(client, options);
  const list = new InfiniteQueryObserver(client, options);
  const unsubscribers: (() => void)[] = [];

  try {
    // The app-wide streamer remains subscribed while the page changes.
    unsubscribers.push(streamer.subscribe(() => undefined));
    const leaveMap = map.subscribe(() => undefined);
    unsubscribers.push(leaveMap);
    let settled = false;
    const loading = client.fetchInfiniteQuery(options).then(() => { settled = true; });
    await writeStarted.promise;
    leaveMap();
    unsubscribers.push(list.subscribe(() => undefined));
    assert.deepEqual(offsets, [0]);
    assert.deepEqual(writes, [[1, 2]]);
    assert.equal(settled, false, 'pagination waits for the current cache write');
    assert.equal(streamer.getCurrentResult().isFetching, true);

    finishWrite.resolve();
    await loading;
    await streamer.fetchNextPage();
    assert.deepEqual(offsets, [0, 2]);
    assert.deepEqual(writes, [[1, 2], [3, 4]], 'previous pages are never rewritten');

    // A later page mount consumes the retained query; it performs no writes.
    unsubscribers.push(map.subscribe(() => undefined));
    await client.fetchInfiniteQuery(options);
    assert.deepEqual(writes, [[1, 2], [3, 4]]);
    assert.deepEqual(list.getCurrentResult().data?.pages.flat(), rows);

    await streamer.fetchNextPage();
    assert.deepEqual(offsets, [0, 2, 4]);
    assert.deepEqual(writes, [[1, 2], [3, 4]], 'empty final pages are not persisted');
  } finally {
    finishWrite.resolve();
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    client.clear();
  }
});

void test('cache-seeded data is not rewritten, but a refetch persists edited data', async () => {
  const client = new QueryClient();
  const queryKey = ['activities', 'auth', 'athlete-a'];
  const writes: { id: number; name: string }[][] = [];
  client.setQueryData(queryKey, {
    pages: [[{ id: 1, name: 'Cached' }]],
    pageParams: [0],
  });
  const options = {
    queryKey,
    queryFn: () => fetchAndPersistPage({
      fetchPage: async () => [{ id: 1, name: 'Edited' }],
      persistPage: async (page) => { writes.push(page); },
      onPersistenceError: (error: unknown) => assert.fail(String(error)),
    }),
    initialPageParam: 0,
    getNextPageParam: () => undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
  };
  const observer = new InfiniteQueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await client.fetchInfiniteQuery(options);
    assert.deepEqual(writes, []);
    await observer.refetch();
    assert.deepEqual(writes, [[{ id: 1, name: 'Edited' }]]);
  } finally {
    unsubscribe();
    client.clear();
  }
});

void test('failed cache writes still return the fetched data', async () => {
  const failure = new Error('IndexedDB quota exceeded');
  const errors: unknown[] = [];
  const page = [{ id: 1 }];
  assert.equal(await fetchAndPersistPage({
    fetchPage: async () => page,
    persistPage: async () => { throw failure; },
    onPersistenceError: (error) => { errors.push(error); },
  }), page);
  assert.deepEqual(errors, [failure]);
});

void test('failed fetches do not write anything to the cache', async () => {
  const failure = new Error('Offline');
  await assert.rejects(fetchAndPersistPage({
    fetchPage: async () => { throw failure; },
    persistPage: async () => { assert.fail('must not persist a failed fetch'); },
    onPersistenceError: () => { assert.fail('fetch errors must reach React Query'); },
  }), failure);
});
