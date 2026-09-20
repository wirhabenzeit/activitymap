import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteLegacyOfflineDatabase } from './v1-store.ts';

type DeleteOutcome = 'success' | 'blocked' | 'error' | 'throw';

function fakeIndexedDb(outcome: DeleteOutcome) {
  let deletedName: string | null = null;

  const factory = {
    deleteDatabase(name: string) {
      deletedName = name;
      if (outcome === 'throw') throw new Error('IndexedDB is disabled');

      const request = {
        onsuccess: null,
        onerror: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest;

      queueMicrotask(() => {
        if (outcome === 'success') request.onsuccess?.(new Event('success'));
        if (outcome === 'blocked') {
          request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent);
        }
        if (outcome === 'error') request.onerror?.(new Event('error'));
      });
      return request;
    },
  } satisfies Pick<IDBFactory, 'deleteDatabase'>;

  return { factory, deletedName: () => deletedName };
}

void test('legacy cache cleanup deletes the exact pre-v1 IndexedDB database', async () => {
  const fake = fakeIndexedDb('success');

  assert.equal(await deleteLegacyOfflineDatabase(fake.factory), 'deleted');
  assert.equal(fake.deletedName(), 'activitymap-offline');
});

void test('legacy cache cleanup is a no-op when IndexedDB is unavailable', async () => {
  assert.equal(await deleteLegacyOfflineDatabase(undefined), 'unavailable');
});

void test('legacy cache cleanup reports a blocked old-tab connection without rejecting', async () => {
  const fake = fakeIndexedDb('blocked');
  assert.equal(await deleteLegacyOfflineDatabase(fake.factory), 'blocked');
});

void test('legacy cache cleanup fails softly for request and synchronous errors', async () => {
  assert.equal(
    await deleteLegacyOfflineDatabase(fakeIndexedDb('error').factory),
    'failed',
  );
  assert.equal(
    await deleteLegacyOfflineDatabase(fakeIndexedDb('throw').factory),
    'failed',
  );
});
