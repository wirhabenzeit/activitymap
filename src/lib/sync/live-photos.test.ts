import assert from 'node:assert/strict';

import test from 'node:test';

import type { PhotoDTO } from '~/contracts/v1/photo';

import { syncLivePhotos } from './live-photos';

const scope = 'auth:user-a';
const photo = (id: string, caption = '') =>
  ({ unique_id: id, activity_id: '1', caption }) as unknown as PhotoDTO;

function harness(held: PhotoDTO[], pages: PhotoDTO[][]) {
  const rows = new Map(held.map((item) => [item.unique_id, item]));
  const log: string[] = [];
  const list = async () => pages.flat();
  const store = {
    getCachedPhotoDTOs: async () => [...rows.values()],
    upsertPhotoDTOs: async (_scope: string, items: PhotoDTO[]) => {
      if (items.length)
        log.push(`upsert ${items.map((item) => item.unique_id).join(',')}`);
      for (const item of items) rows.set(item.unique_id, item);
    },
    deletePhotoDTOsByIds: async (_scope: string, ids: string[]) => {
      if (ids.length) log.push(`delete ${ids.join(',')}`);
      for (const id of ids) rows.delete(id);
    },
  };
  return { rows, log, list, store };
}

const commit = (write: (signal: AbortSignal) => Promise<void>) =>
  write(new AbortController().signal);

void test('the store is reconciled with the listed photos', async () => {
  const { rows, log, list, store } = harness(
    [photo('a'), photo('b', 'old'), photo('gone')],
    [[photo('a'), photo('b', 'new')], [photo('c')]],
  );
  const changed = await syncLivePhotos({
    scope,
    signal: new AbortController().signal,
    commit,
    list,
    store,
  });
  assert.equal(changed, true);
  // Unchanged photos are not rewritten.
  assert.deepEqual(log, ['upsert b,c', 'delete gone']);
  assert.deepEqual([...rows.keys()].sort(), ['a', 'b', 'c']);
  assert.equal((rows.get('b') as { caption?: string }).caption, 'new');
});

void test('an unchanged photo list writes nothing', async () => {
  const { log, list, store } = harness([photo('a')], [[photo('a')]]);
  const changed = await syncLivePhotos({
    scope,
    signal: new AbortController().signal,
    commit,
    list,
    store,
  });
  assert.equal(changed, false);
  assert.deepEqual(log, []);
});

void test('a fenced writer or a failed download leaves the store untouched', async () => {
  const fenced = harness([photo('a')], [[photo('b')]]);
  const retired = new AbortController();
  retired.abort();
  await assert.rejects(
    syncLivePhotos({
      scope,
      signal: new AbortController().signal,
      commit: (write) => write(retired.signal),
      list: fenced.list,
      store: fenced.store,
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(fenced.log, []);

  // A list that could not be read completely must not delete anything.
  const failing = harness([photo('a')], []);
  await assert.rejects(
    syncLivePhotos({
      scope,
      signal: new AbortController().signal,
      commit,
      list: async () => {
        throw new Error('offline');
      },
      store: failing.store,
    }),
    /offline/,
  );
  assert.deepEqual(failing.log, []);
});
