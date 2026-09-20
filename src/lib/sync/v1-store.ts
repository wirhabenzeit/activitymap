'use client';

/**
 * IndexedDB-backed local cache for the v1 sync protocol (issue #126).
 *
 * Unlike the legacy cache (`~/lib/offline/db.ts`), every row stored here is
 * the wire DTO itself (`~/contracts/v1/activity.ts`'s `ActivityDTO` /
 * `~/contracts/v1/photo.ts`'s `PhotoDTO`) — decimal-string ids, ISO-string
 * timestamps — never a Drizzle row type. That is the acceptance criterion
 * this module exists to satisfy: the local store's own types come from
 * `~/contracts/v1/*`, not `~/server/db/schema`. Callers that need the
 * app-wide `Activity`/`Photo` view-model shape convert at the boundary via
 * `~/lib/sync/v1-mappers.ts`.
 *
 * This is a separate IndexedDB database (`activitymap-sync-v1`) from the
 * legacy cache, deliberately: issue #126 phase 1 is purely additive and
 * must not touch the legacy cache's schema or data while it is still the
 * one actually serving the app. Phase 2 switches the hooks over to this
 * store; phase 3 removes the legacy one.
 */

import type { ActivityDTO } from '~/contracts/v1/activity';
import type { PhotoDTO } from '~/contracts/v1/photo';

const DB_NAME = 'activitymap-sync-v1';
const DB_VERSION = 1;

const ACTIVITIES_STORE = 'activities';
const PHOTOS_STORE = 'photos';
const SYNC_STATE_STORE = 'sync_state';

type ActivityRecord = { pk: string; scope: string; id: string; data: ActivityDTO };
type PhotoRecord = { pk: string; scope: string; id: string; data: PhotoDTO };

/**
 * Per-scope sync progress. `bootstrapCursor` is the `snapshotCursor` a
 * bootstrap run captured; it becomes `changesCursor`'s initial value only
 * once bootstrap has fully finished (`bootstrapComplete`) — applying it
 * earlier would let a `/sync/changes` catch-up race ahead of bootstrap
 * pages still being applied.
 */
export type V1SyncState = {
  scope: string;
  bootstrapCursor: string | null;
  bootstrapComplete: boolean;
  changesCursor: string | null;
  lastSyncAt: string | null;
  updatedAt: string;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

const isIndexedDbAvailable = (): boolean =>
  typeof window !== 'undefined' && 'indexedDB' in window;

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

const txToPromise = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });

const openDatabase = async (): Promise<IDBDatabase | null> => {
  if (!isIndexedDbAvailable()) return null;

  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(ACTIVITIES_STORE)) {
        const store = db.createObjectStore(ACTIVITIES_STORE, { keyPath: 'pk' });
        store.createIndex('by_scope', 'scope', { unique: false });
      }
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        const store = db.createObjectStore(PHOTOS_STORE, { keyPath: 'pk' });
        store.createIndex('by_scope', 'scope', { unique: false });
      }
      if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
        db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'scope' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });

  return dbPromise;
};

const buildPk = (scope: string, id: string): string => `${scope}:${id}`;

export const getCachedActivityDTOs = async (scope: string): Promise<ActivityDTO[]> => {
  const db = await openDatabase();
  if (!db) return [];

  const tx = db.transaction(ACTIVITIES_STORE, 'readonly');
  const rows = (await requestToPromise(
    tx.objectStore(ACTIVITIES_STORE).index('by_scope').getAll(scope),
  )) as ActivityRecord[];
  await txToPromise(tx);
  return rows.map((row) => row.data);
};

export const upsertActivityDTOs = async (
  scope: string,
  items: ActivityDTO[],
): Promise<void> => {
  if (items.length === 0) return;
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
  const store = tx.objectStore(ACTIVITIES_STORE);
  for (const item of items) {
    store.put({ pk: buildPk(scope, item.id), scope, id: item.id, data: item } satisfies ActivityRecord);
  }
  await txToPromise(tx);
};

export const deleteActivityDTOsByIds = async (
  scope: string,
  ids: string[],
): Promise<void> => {
  if (ids.length === 0) return;
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
  const store = tx.objectStore(ACTIVITIES_STORE);
  for (const id of ids) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    store.delete(buildPk(scope, id));
  }
  await txToPromise(tx);
};

export const getCachedPhotoDTOs = async (scope: string): Promise<PhotoDTO[]> => {
  const db = await openDatabase();
  if (!db) return [];

  const tx = db.transaction(PHOTOS_STORE, 'readonly');
  const rows = (await requestToPromise(
    tx.objectStore(PHOTOS_STORE).index('by_scope').getAll(scope),
  )) as PhotoRecord[];
  await txToPromise(tx);
  return rows.map((row) => row.data);
};

export const upsertPhotoDTOs = async (scope: string, items: PhotoDTO[]): Promise<void> => {
  if (items.length === 0) return;
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(PHOTOS_STORE, 'readwrite');
  const store = tx.objectStore(PHOTOS_STORE);
  for (const item of items) {
    store.put({
      pk: buildPk(scope, item.unique_id),
      scope,
      id: item.unique_id,
      data: item,
    } satisfies PhotoRecord);
  }
  await txToPromise(tx);
};

export const deletePhotoDTOsByIds = async (scope: string, ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(PHOTOS_STORE, 'readwrite');
  const store = tx.objectStore(PHOTOS_STORE);
  for (const id of ids) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    store.delete(buildPk(scope, id));
  }
  await txToPromise(tx);
};

export const deletePhotoDTOsByActivityIds = async (
  scope: string,
  activityIds: string[],
): Promise<void> => {
  if (activityIds.length === 0) return;
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(PHOTOS_STORE, 'readwrite');
  const store = tx.objectStore(PHOTOS_STORE);
  const rows = (await requestToPromise(
    store.index('by_scope').getAll(scope),
  )) as PhotoRecord[];
  const activityIdSet = new Set(activityIds);
  for (const row of rows) {
    if (activityIdSet.has(row.data.activity_id)) {
      // eslint-disable-next-line drizzle/enforce-delete-with-where
      store.delete(row.pk);
    }
  }
  await txToPromise(tx);
};

export const getV1SyncState = async (scope: string): Promise<V1SyncState | null> => {
  const db = await openDatabase();
  if (!db) return null;

  const tx = db.transaction(SYNC_STATE_STORE, 'readonly');
  const state = (await requestToPromise(tx.objectStore(SYNC_STATE_STORE).get(scope))) as
    | V1SyncState
    | undefined;
  await txToPromise(tx);
  return state ?? null;
};

export const setV1SyncState = async (state: V1SyncState): Promise<void> => {
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
  tx.objectStore(SYNC_STATE_STORE).put(state);
  await txToPromise(tx);
};

export const clearV1Scope = async (scope: string): Promise<void> => {
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(
    [ACTIVITIES_STORE, PHOTOS_STORE, SYNC_STATE_STORE],
    'readwrite',
  );

  for (const storeName of [ACTIVITIES_STORE, PHOTOS_STORE] as const) {
    const store = tx.objectStore(storeName);
    const keys = await requestToPromise(store.index('by_scope').getAllKeys(scope));
    for (const key of keys) {
      // eslint-disable-next-line drizzle/enforce-delete-with-where
      store.delete(key);
    }
  }
  // eslint-disable-next-line drizzle/enforce-delete-with-where
  tx.objectStore(SYNC_STATE_STORE).delete(scope);

  await txToPromise(tx);
};
