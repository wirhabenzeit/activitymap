'use client';

/**
 * IndexedDB-backed local cache for the v1 sync protocol (issue #126).
 *
 * Every row stored here is the wire DTO itself (`~/contracts/v1/activity.ts`'s
 * `ActivityDTO` / `~/contracts/v1/photo.ts`'s `PhotoDTO`) — decimal-string
 * ids, ISO-string timestamps — never a Drizzle row type. That is the
 * acceptance criterion this module exists to satisfy: the local store's own
 * types come from `~/contracts/v1/*`, not `~/server/db/schema`. Callers that
 * need the app-wide `Activity`/`Photo` view-model shape convert at the
 * boundary via `~/lib/sync/v1-mappers.ts`.
 *
 * This was introduced as a separate IndexedDB database
 * (`activitymap-sync-v1`) from the now-removed legacy cache, deliberately:
 * issue #126 phase 1 was purely additive and could not touch the legacy
 * cache's schema or data while it was still serving the app. Phase 2
 * switched the hooks over to this store; phase 3 removed the legacy one
 * entirely (this is now the only client-side activity/photo cache).
 */

import type { ActivityDTO } from '~/contracts/v1/activity';
import type { PhotoDTO } from '~/contracts/v1/photo';
import {
  canReuseCachedStreamSummary,
  type CachedStreamSummary,
} from '~/lib/streams/summary-cache-record';

const DB_NAME = 'activitymap-sync-v1';
const DB_VERSION = 2;
const LEGACY_DB_NAME = 'activitymap-offline';

const ACTIVITIES_STORE = 'activities';
const PHOTOS_STORE = 'photos';
const SYNC_STATE_STORE = 'sync_state';
const STREAM_SUMMARIES_STORE = 'stream_summaries';

type ActivityRecord = {
  pk: string;
  scope: string;
  id: string;
  data: ActivityDTO;
};
type PhotoRecord = { pk: string; scope: string; id: string; data: PhotoDTO };
type StreamSummaryRecord = CachedStreamSummary & {
  pk: string;
  scope: string;
  id: string;
};

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

export class OfflineCacheUpgradeBlockedError extends Error {
  constructor() {
    super(
      'Close other ActivityMap tabs and retry to upgrade the offline cache.',
    );
  }
}

const isIndexedDbAvailable = (): boolean =>
  typeof window !== 'undefined' && 'indexedDB' in window;

export type LegacyOfflineDatabaseCleanupResult =
  'deleted' | 'blocked' | 'failed' | 'unavailable';

/**
 * Remove the pre-v1 cache after a complete v1 sync has proven the replacement
 * store is usable. This intentionally lives beside the surviving v1 store,
 * rather than importing the legacy module that phase 3 deletes.
 *
 * Deletion is best-effort and never rejects: another open tab can temporarily
 * block IndexedDB deletion, and cache cleanup must not turn an otherwise
 * successful sync into an application failure. The browser keeps a blocked
 * delete request pending and completes it once the old connection closes.
 */
export const deleteLegacyOfflineDatabase = async (
  factory:
    Pick<IDBFactory, 'deleteDatabase'> | undefined = isIndexedDbAvailable()
    ? window.indexedDB
    : undefined,
): Promise<LegacyOfflineDatabaseCleanupResult> => {
  if (!factory) return 'unavailable';

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(LEGACY_DB_NAME);
    } catch {
      resolve('failed');
      return;
    }

    request.onsuccess = () => resolve('deleted');
    request.onerror = () => resolve('failed');
    request.onblocked = () => resolve('blocked');
  });
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'));
  });

const txToPromise = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () =>
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });

const openDatabase = async (): Promise<IDBDatabase | null> => {
  if (!isIndexedDbAvailable()) return null;

  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      dbPromise = null;
      reject(new OfflineCacheUpgradeBlockedError());
    };

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
      if (!db.objectStoreNames.contains(STREAM_SUMMARIES_STORE)) {
        const store = db.createObjectStore(STREAM_SUMMARIES_STORE, {
          keyPath: 'pk',
        });
        store.createIndex('by_scope', 'scope', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
};

const buildPk = (scope: string, id: string): string => `${scope}:${id}`;

export const getCachedActivityDTOs = async (
  scope: string,
): Promise<ActivityDTO[]> => {
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

  const tx = db.transaction(
    [ACTIVITIES_STORE, STREAM_SUMMARIES_STORE],
    'readwrite',
  );
  const store = tx.objectStore(ACTIVITIES_STORE);
  const summaries = tx.objectStore(STREAM_SUMMARIES_STORE);
  for (const item of items) {
    const pk = buildPk(scope, item.id);
    const request = summaries.get(pk) as IDBRequest<
      StreamSummaryRecord | undefined
    >;
    request.onsuccess = () => {
      if (
        request.result &&
        !canReuseCachedStreamSummary(request.result, item.streams)
      ) {
        // eslint-disable-next-line drizzle/enforce-delete-with-where
        summaries.delete(pk);
      }
    };
    store.put({
      pk: buildPk(scope, item.id),
      scope,
      id: item.id,
      data: item,
    } satisfies ActivityRecord);
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

  const tx = db.transaction(
    [ACTIVITIES_STORE, STREAM_SUMMARIES_STORE],
    'readwrite',
  );
  const store = tx.objectStore(ACTIVITIES_STORE);
  for (const id of ids) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    store.delete(buildPk(scope, id));
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    tx.objectStore(STREAM_SUMMARIES_STORE).delete(buildPk(scope, id));
  }
  await txToPromise(tx);
};

export const getCachedPhotoDTOs = async (
  scope: string,
): Promise<PhotoDTO[]> => {
  const db = await openDatabase();
  if (!db) return [];

  const tx = db.transaction(PHOTOS_STORE, 'readonly');
  const rows = (await requestToPromise(
    tx.objectStore(PHOTOS_STORE).index('by_scope').getAll(scope),
  )) as PhotoRecord[];
  await txToPromise(tx);
  return rows.map((row) => row.data);
};

export const upsertPhotoDTOs = async (
  scope: string,
  items: PhotoDTO[],
): Promise<void> => {
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

export const deletePhotoDTOsByIds = async (
  scope: string,
  ids: string[],
): Promise<void> => {
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

export const getV1SyncState = async (
  scope: string,
): Promise<V1SyncState | null> => {
  const db = await openDatabase();
  if (!db) return null;

  const tx = db.transaction(SYNC_STATE_STORE, 'readonly');
  const state = (await requestToPromise(
    tx.objectStore(SYNC_STATE_STORE).get(scope),
  )) as V1SyncState | undefined;
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
    [ACTIVITIES_STORE, PHOTOS_STORE, SYNC_STATE_STORE, STREAM_SUMMARIES_STORE],
    'readwrite',
  );

  for (const storeName of [
    ACTIVITIES_STORE,
    PHOTOS_STORE,
    STREAM_SUMMARIES_STORE,
  ] as const) {
    const store = tx.objectStore(storeName);
    const keys = await requestToPromise(
      store.index('by_scope').getAllKeys(scope),
    );
    for (const key of keys) {
      // eslint-disable-next-line drizzle/enforce-delete-with-where
      store.delete(key);
    }
  }
  // eslint-disable-next-line drizzle/enforce-delete-with-where
  tx.objectStore(SYNC_STATE_STORE).delete(scope);

  await txToPromise(tx);
};

export const getCachedStreamSummaries = async (
  scope: string,
  ids: string[],
): Promise<Map<string, CachedStreamSummary>> => {
  const db = await openDatabase();
  if (!db || ids.length === 0) return new Map();
  const tx = db.transaction(STREAM_SUMMARIES_STORE, 'readonly');
  const completed = txToPromise(tx);
  const rows = await Promise.all(
    ids.map((id) =>
      requestToPromise(
        tx
          .objectStore(STREAM_SUMMARIES_STORE)
          .get(buildPk(scope, id)) as IDBRequest<
          StreamSummaryRecord | undefined
        >,
      ),
    ),
  );
  await completed;
  return new Map(
    rows.flatMap((row) =>
      row
        ? [
            [
              row.id,
              { data: row.data, requestedAgainst: row.requestedAgainst },
            ] as const,
          ]
        : [],
    ),
  );
};

/**
 * Read the activity and write its summary in one transaction. This prevents a
 * late network response (including one from another tab) resurrecting deleted
 * activities or crossing a stream revision change. The caller's fence also
 * rejects responses from a previous account session or bootstrap.
 */
export const putCachedStreamSummaries = async (
  scope: string,
  records: CachedStreamSummary[],
  isCurrent: (id: string) => boolean,
): Promise<void> => {
  const db = await openDatabase();
  if (!db || records.length === 0) return;
  const tx = db.transaction(
    [ACTIVITIES_STORE, STREAM_SUMMARIES_STORE],
    'readwrite',
  );
  const summaries = tx.objectStore(STREAM_SUMMARIES_STORE);
  for (const record of records) {
    const id = record.data.activity_id;
    const pk = buildPk(scope, id);
    const activity = tx.objectStore(ACTIVITIES_STORE).get(pk) as IDBRequest<
      ActivityRecord | undefined
    >;
    activity.onsuccess = () => {
      if (
        !isCurrent(id) ||
        !activity.result ||
        !canReuseCachedStreamSummary(record, activity.result.data.streams)
      )
        return;
      const existing = summaries.get(pk) as IDBRequest<
        StreamSummaryRecord | undefined
      >;
      existing.onsuccess = () => {
        if (!isCurrent(id)) return;
        const prior = existing.result?.data.metadata;
        if (
          prior?.generation === record.data.metadata.generation &&
          BigInt(prior.revision) > BigInt(record.data.metadata.revision)
        )
          return;
        summaries.put({
          ...record,
          pk,
          scope,
          id,
        } satisfies StreamSummaryRecord);
      };
    };
  }
  await txToPromise(tx);
};

export const clearCachedStreamSummaries = async (
  scope: string,
): Promise<void> => {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction(STREAM_SUMMARIES_STORE, 'readwrite');
  const completed = txToPromise(tx);
  const store = tx.objectStore(STREAM_SUMMARIES_STORE);
  const keys = await requestToPromise(
    store.index('by_scope').getAllKeys(scope),
  );
  for (const key of keys) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    store.delete(key);
  }
  await completed;
};

export const deleteCachedStreamSummary = async (
  scope: string,
  id: string,
): Promise<void> => {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction(STREAM_SUMMARIES_STORE, 'readwrite');
  // eslint-disable-next-line drizzle/enforce-delete-with-where
  tx.objectStore(STREAM_SUMMARIES_STORE).delete(buildPk(scope, id));
  await txToPromise(tx);
};
