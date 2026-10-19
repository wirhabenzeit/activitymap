/* eslint-disable drizzle/enforce-delete-with-where -- This module uses IndexedDB, never Drizzle. */
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
import type { SyncChangeItemDTO } from '~/contracts/v1/sync';
import {
  type CachedStreamSummary,
  canReuseCachedStreamSummary,
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

export type V1LibrarySnapshot = {
  activities: ActivityDTO[];
  photos: PhotoDTO[];
  syncState: V1SyncState | null;
};

export type V1LibraryCommit = {
  scope: string;
  revision: number;
  kind: 'write' | 'clear';
};

const libraryListeners = new Set<(commit: V1LibraryCommit) => void>();
const libraryRevisions = new Map<string, number>();
let libraryChannel: BroadcastChannel | null = null;
const LIBRARY_CHANNEL_NAME = 'activitymap:library-commits-v1';

function publishLibraryCommit(
  scope: string,
  kind: V1LibraryCommit['kind'],
  remote = false,
) {
  const revision = (libraryRevisions.get(scope) ?? 0) + 1;
  libraryRevisions.set(scope, revision);
  for (const listener of libraryListeners) {
    try {
      listener({ scope, revision, kind });
    } catch (error) {
      console.error('Library commit subscriber failed', error);
    }
  }
  if (!remote) {
    let channel = libraryChannel;
    try {
      // A sign-out clear can commit after the final local owner was released.
      // Other tabs still need the invalidation even without a local listener.
      if (
        !channel &&
        typeof window !== 'undefined' &&
        typeof window.BroadcastChannel === 'function'
      ) {
        channel = new window.BroadcastChannel(LIBRARY_CHANNEL_NAME);
      }
      channel?.postMessage({ version: 1, scope, kind });
    } catch {
      /* A closed/unavailable channel never undoes a committed transaction. */
    } finally {
      if (channel && channel !== libraryChannel) channel.close();
    }
  }
}

/** Invalidation only: DTOs never leave IndexedDB over the cross-tab channel. */
export function subscribeV1LibraryCommits(
  listener: (commit: V1LibraryCommit) => void,
) {
  libraryListeners.add(listener);
  if (
    !libraryChannel &&
    typeof window !== 'undefined' &&
    typeof window.BroadcastChannel === 'function'
  ) {
    try {
      libraryChannel = new window.BroadcastChannel(LIBRARY_CHANNEL_NAME);
      libraryChannel.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data !== 'object' || !data) return;
        const value = data as {
          version?: unknown;
          scope?: unknown;
          kind?: unknown;
        };
        if (
          value.version === 1 &&
          typeof value.scope === 'string' &&
          (value.kind === 'write' || value.kind === 'clear')
        ) {
          publishLibraryCommit(value.scope, value.kind, true);
        }
      };
    } catch {
      /* Storage reads still work when BroadcastChannel is unavailable. */
    }
  }
  return () => {
    libraryListeners.delete(listener);
    if (libraryListeners.size === 0) {
      libraryChannel?.close();
      libraryChannel = null;
    }
  };
}

/** Read the entire visible library/checkpoint at a single transaction boundary. */
export async function readV1LibrarySnapshot(
  scope: string,
  signal?: AbortSignal,
): Promise<V1LibrarySnapshot> {
  signal?.throwIfAborted();
  const db = await openDatabase();
  if (!db) throw new Error('IndexedDB is unavailable');
  signal?.throwIfAborted();
  const tx = db.transaction(
    [ACTIVITIES_STORE, PHOTOS_STORE, SYNC_STATE_STORE],
    'readonly',
  );
  const completed = txToPromise(tx);
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already finished. */
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const activities = requestToPromise(
      tx
        .objectStore(ACTIVITIES_STORE)
        .index('by_scope')
        .getAll(scope) as IDBRequest<ActivityRecord[]>,
    );
    const photos = requestToPromise(
      tx
        .objectStore(PHOTOS_STORE)
        .index('by_scope')
        .getAll(scope) as IDBRequest<PhotoRecord[]>,
    );
    const state = requestToPromise(
      tx.objectStore(SYNC_STATE_STORE).get(scope) as IDBRequest<
        V1SyncState | undefined
      >,
    );
    const [activityRows, photoRows, syncState] = await Promise.all([
      activities,
      photos,
      state,
      completed,
    ]);
    signal?.throwIfAborted();
    return {
      activities: activityRows.map((row) => row.data),
      photos: photoRows.map((row) => row.data),
      syncState: syncState ?? null,
    };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

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

/** One ordered feed/bootstrap mutation. IDs and data are the wire DTOs. */
export type V1SyncMutation = SyncChangeItemDTO;

/**
 * Commit the page and the cursor acknowledging it in ONE transaction. Reads
 * and writes stay inside IDB request callbacks, with no network/callback await
 * that could let the transaction auto-commit. An abort rolls back all stores.
 * Replacement is used only after a complete bootstrap and catch-up is staged.
 */
export const applyV1SyncPage = async (
  scope: string,
  mutations: V1SyncMutation[],
  state: V1SyncState,
  options: { replace?: boolean; signal?: AbortSignal } = {},
): Promise<void> => {
  options.signal?.throwIfAborted();
  if (state.scope !== scope) throw new Error('Sync checkpoint scope mismatch');
  if (options.replace && (!state.bootstrapComplete || !state.lastSyncAt)) {
    throw new Error('Cannot replace with an incomplete snapshot');
  }
  const db = await openDatabase();
  if (!db) throw new Error('IndexedDB is unavailable');
  options.signal?.throwIfAborted();
  const tx = db.transaction(
    [ACTIVITIES_STORE, PHOTOS_STORE, SYNC_STATE_STORE, STREAM_SUMMARIES_STORE],
    'readwrite',
  );
  const completed = txToPromise(tx);
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already finished. */
    }
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  let failure: unknown;
  try {
    // Only parent deletes need existing photos, and only activity upserts need
    // summary metadata. Empty polls must not materialize the whole library.
    const photos = tx.objectStore(PHOTOS_STORE);
    const summaries = tx.objectStore(STREAM_SUMMARIES_STORE);
    const needsPhotos =
      options.replace === true ||
      mutations.some(
        (item) => item.entityType === 'activity' && item.operation === 'delete',
      );
    const photoRequest = needsPhotos
      ? (photos.index('by_scope').getAll(scope) as IDBRequest<PhotoRecord[]>)
      : null;
    const upsertIds = new Set(
      mutations
        .filter(
          (item) =>
            item.entityType === 'activity' && item.operation === 'upsert',
        )
        .map((item) => item.id),
    );
    const summaryRequests = options.replace
      ? []
      : [...upsertIds].map(
          (id) =>
            summaries.get(buildPk(scope, id)) as IDBRequest<
              StreamSummaryRecord | undefined
            >,
        );
    const activityKeys = options.replace
      ? tx.objectStore(ACTIVITIES_STORE).index('by_scope').getAllKeys(scope)
      : null;
    const summaryKeys = options.replace
      ? summaries.index('by_scope').getAllKeys(scope)
      : null;
    const reads = [
      photoRequest,
      activityKeys,
      summaryKeys,
      ...summaryRequests,
    ].filter((request) => request !== null);
    let pending = Math.max(1, reads.length);
    const apply = () => {
      if (--pending > 0) return;
      try {
        options.signal?.throwIfAborted();
        const photoRows = new Map(
          (photoRequest?.result ?? []).map((row) => [row.id, row]),
        );
        const summaryRows = new Map<string, StreamSummaryRecord>(
          summaryRequests.flatMap((request) =>
            request.result ? [[request.result.id, request.result]] : [],
          ),
        );
        const activities = tx.objectStore(ACTIVITIES_STORE);
        if (options.replace) {
          for (const key of activityKeys!.result) activities.delete(key);
          for (const row of photoRows.values()) photos.delete(row.pk);
          for (const key of summaryKeys!.result) summaries.delete(key);
          photoRows.clear();
          summaryRows.clear();
        }
        const replacementActivityIds = new Set<string>();
        for (const item of mutations) {
          const pk = buildPk(scope, item.id);
          if (item.entityType === 'activity') {
            if (item.operation === 'delete') {
              replacementActivityIds.delete(item.id);
              activities.delete(pk);
              summaries.delete(pk);
              summaryRows.delete(item.id);
              for (const [id, row] of photoRows) {
                if (row.data.activity_id === item.id) {
                  photos.delete(row.pk);
                  photoRows.delete(id);
                }
              }
            } else {
              if (item.activity?.id !== item.id || item.photo)
                throw new Error('Invalid activity mutation');
              const summary = summaryRows.get(item.id);
              if (
                summary &&
                !canReuseCachedStreamSummary(summary, item.activity.streams)
              ) {
                summaries.delete(pk);
                summaryRows.delete(item.id);
              }
              replacementActivityIds.add(item.id);
              activities.put({
                pk,
                scope,
                id: item.id,
                data: item.activity,
              } satisfies ActivityRecord);
            }
          } else if (item.operation === 'delete') {
            photos.delete(pk);
            photoRows.delete(item.id);
          } else {
            if (item.photo?.unique_id !== item.id || item.activity)
              throw new Error('Invalid photo mutation');
            const row: PhotoRecord = {
              pk,
              scope,
              id: item.id,
              data: item.photo,
            };
            photoRows.set(item.id, row);
            photos.put(row);
          }
        }
        if (options.replace) {
          for (const row of photoRows.values()) {
            if (!replacementActivityIds.has(row.data.activity_id))
              photos.delete(row.pk);
          }
        }
        tx.objectStore(SYNC_STATE_STORE).put(state);
      } catch (error) {
        failure = error;
        abort();
      }
    };
    if (reads.length === 0) apply();
    else for (const request of reads) request.onsuccess = apply;
    await completed;
  } catch (error) {
    throw failure ?? (options.signal?.aborted ? options.signal.reason : error);
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
  publishLibraryCommit(scope, 'write');
};

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
  publishLibraryCommit(scope, 'write');
};

/** Called only by the library writer. Does not advance or invent a sync cursor. */
export async function commitActivityResponse(
  scope: string,
  activity: ActivityDTO,
  replacementPhotos: PhotoDTO[] | undefined,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const db = await openDatabase();
  if (!db) throw new Error('IndexedDB is unavailable');
  signal.throwIfAborted();
  const tx = db.transaction(
    [ACTIVITIES_STORE, PHOTOS_STORE, STREAM_SUMMARIES_STORE],
    'readwrite',
  );
  const completed = txToPromise(tx);
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already committed. */
    }
  };
  signal.addEventListener('abort', abort, { once: true });
  const activities = tx.objectStore(ACTIVITIES_STORE);
  const photos = tx.objectStore(PHOTOS_STORE);
  const pk = buildPk(scope, activity.id);
  const existing = activities.get(pk) as IDBRequest<ActivityRecord | undefined>;
  const previousPhotos =
    replacementPhotos === undefined
      ? null
      : (photos.index('by_scope').getAll(scope) as IDBRequest<PhotoRecord[]>);
  let remaining = previousPhotos ? 2 : 1;
  const apply = () => {
    if (--remaining) return;
    if (signal.aborted) {
      abort();
      return;
    }
    // Never resurrect a deletion or overwrite a newer download/other-tab edit.
    const old = existing.result?.data;
    if (
      !old ||
      (old.last_updated &&
        (!activity.last_updated || old.last_updated > activity.last_updated))
    )
      return;
    activities.put({
      pk,
      scope,
      id: activity.id,
      data: activity,
    } satisfies ActivityRecord);
    tx.objectStore(STREAM_SUMMARIES_STORE).delete(pk);
    if (replacementPhotos !== undefined) {
      for (const photo of previousPhotos?.result ?? []) {
        if (photo.data.activity_id === activity.id) photos.delete(photo.pk);
      }
      for (const photo of replacementPhotos) {
        photos.put({
          pk: buildPk(scope, photo.unique_id),
          scope,
          id: photo.unique_id,
          data: photo,
        } satisfies PhotoRecord);
      }
    }
  };
  existing.onsuccess = apply;
  if (previousPhotos) previousPhotos.onsuccess = apply;
  try {
    await completed;
    signal.throwIfAborted();
    publishLibraryCommit(scope, 'write');
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

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
    store.delete(buildPk(scope, id));
    tx.objectStore(STREAM_SUMMARIES_STORE).delete(buildPk(scope, id));
  }
  await txToPromise(tx);
  publishLibraryCommit(scope, 'write');
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
  publishLibraryCommit(scope, 'write');
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
    store.delete(buildPk(scope, id));
  }
  await txToPromise(tx);
  publishLibraryCommit(scope, 'write');
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
      store.delete(row.pk);
    }
  }
  await txToPromise(tx);
  publishLibraryCommit(scope, 'write');
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
  publishLibraryCommit(state.scope, 'write');
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
      store.delete(key);
    }
  }
  tx.objectStore(SYNC_STATE_STORE).delete(scope);

  await txToPromise(tx);
  publishLibraryCommit(scope, 'clear');
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
  tx.objectStore(STREAM_SUMMARIES_STORE).delete(buildPk(scope, id));
  await txToPromise(tx);
};
