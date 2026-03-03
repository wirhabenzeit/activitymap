import type { Activity, Photo } from '~/server/db/schema';

const DB_NAME = 'activitymap-offline';
const DB_VERSION = 1;

const ACTIVITIES_STORE = 'activities';
const PHOTOS_STORE = 'photos';
const SYNC_META_STORE = 'sync_meta';
const APP_META_STORE = 'app_meta';

type OfflineActivityRecord = {
  pk: string;
  userScope: string;
  activityId: number;
  lastUpdatedMs: number;
  data: Activity;
};

type OfflinePhotoRecord = {
  pk: string;
  userScope: string;
  photoId: string;
  lastUpdatedMs: number;
  data: Photo;
};

export type OfflineSyncMeta = {
  userScope: string;
  lastSyncAt: string | null;
  cursor: string | null;
  updatedAt: string;
};

type AppMetaRecord = {
  key: string;
  value: string;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

const isIndexedDbAvailable = (): boolean =>
  typeof window !== 'undefined' && 'indexedDB' in window;

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
  if (!isIndexedDbAvailable()) {
    return null;
  }

  dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(ACTIVITIES_STORE)) {
          const store = db.createObjectStore(ACTIVITIES_STORE, {
            keyPath: 'pk',
          });
          store.createIndex('by_user_scope', 'userScope', { unique: false });
          store.createIndex('by_user_scope_updated', ['userScope', 'lastUpdatedMs'], {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
          const store = db.createObjectStore(PHOTOS_STORE, {
            keyPath: 'pk',
          });
          store.createIndex('by_user_scope', 'userScope', { unique: false });
          store.createIndex('by_user_scope_updated', ['userScope', 'lastUpdatedMs'], {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
          db.createObjectStore(SYNC_META_STORE, {
            keyPath: 'userScope',
          });
        }

        if (!db.objectStoreNames.contains(APP_META_STORE)) {
          db.createObjectStore(APP_META_STORE, {
            keyPath: 'key',
          });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to open IndexedDB'));
    });

  return dbPromise;
};

const buildActivityPk = (userScope: string, activityId: number): string =>
  `${userScope}:${activityId}`;

const buildPhotoPk = (userScope: string, photoId: string): string =>
  `${userScope}:${photoId}`;

const toMs = (date: Date | string | null | undefined): number => {
  if (!date) return 0;
  const value = new Date(date).getTime();
  return Number.isFinite(value) ? value : 0;
};

export const getCachedActivities = async (
  userScope: string,
): Promise<Activity[]> => {
  const db = await openDatabase();
  if (!db) return [];

  const tx = db.transaction(ACTIVITIES_STORE, 'readonly');
  const store = tx.objectStore(ACTIVITIES_STORE);
  const index = store.index('by_user_scope');
  const rows = await requestToPromise(index.getAll(userScope)) as OfflineActivityRecord[];
  await txToPromise(tx);

  return rows
    .map((row) => row.data)
    .sort(
      (a, b) =>
        new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
    );
};

export const upsertCachedActivities = async (
  userScope: string,
  activities: Activity[],
): Promise<void> => {
  if (activities.length === 0) return;

  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
  const store = tx.objectStore(ACTIVITIES_STORE);

  for (const activity of activities) {
    const row: OfflineActivityRecord = {
      pk: buildActivityPk(userScope, activity.id),
      userScope,
      activityId: activity.id,
      lastUpdatedMs: toMs(activity.last_updated ?? activity.start_date),
      data: activity,
    };
    store.put(row);
  }

  await txToPromise(tx);
};

export const getCachedPhotos = async (userScope: string): Promise<Photo[]> => {
  const db = await openDatabase();
  if (!db) return [];

  const tx = db.transaction(PHOTOS_STORE, 'readonly');
  const store = tx.objectStore(PHOTOS_STORE);
  const index = store.index('by_user_scope');
  const rows = await requestToPromise(index.getAll(userScope)) as OfflinePhotoRecord[];
  await txToPromise(tx);

  return rows.map((row) => row.data);
};

export const upsertCachedPhotos = async (
  userScope: string,
  photos: Photo[],
): Promise<void> => {
  if (photos.length === 0) return;

  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(PHOTOS_STORE, 'readwrite');
  const store = tx.objectStore(PHOTOS_STORE);

  for (const photo of photos) {
    const row: OfflinePhotoRecord = {
      pk: buildPhotoPk(userScope, photo.unique_id),
      userScope,
      photoId: photo.unique_id,
      lastUpdatedMs: toMs(photo.created_at ?? photo.uploaded_at),
      data: photo,
    };
    store.put(row);
  }

  await txToPromise(tx);
};

export const deleteCachedActivitiesByIds = async (
  userScope: string,
  activityIds: number[],
): Promise<void> => {
  if (activityIds.length === 0) return;

  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
  const store = tx.objectStore(ACTIVITIES_STORE);
  for (const id of activityIds) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    store.delete(buildActivityPk(userScope, id));
  }
  await txToPromise(tx);
};

export const deleteCachedPhotosByIds = async (
  userScope: string,
  photoIds: string[],
): Promise<void> => {
  if (photoIds.length === 0) return;

  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(PHOTOS_STORE, 'readwrite');
  const store = tx.objectStore(PHOTOS_STORE);
  for (const id of photoIds) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    store.delete(buildPhotoPk(userScope, id));
  }
  await txToPromise(tx);
};

export const deleteCachedPhotosByActivityIds = async (
  userScope: string,
  activityIds: number[],
): Promise<void> => {
  if (activityIds.length === 0) return;

  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(PHOTOS_STORE, 'readwrite');
  const store = tx.objectStore(PHOTOS_STORE);
  const index = store.index('by_user_scope');
  const photoRows = await requestToPromise(
    index.getAll(userScope),
  ) as OfflinePhotoRecord[];
  const activityIdSet = new Set(activityIds);

  for (const row of photoRows) {
    if (activityIdSet.has(row.data.activity_id)) {
      // eslint-disable-next-line drizzle/enforce-delete-with-where
      store.delete(row.pk);
    }
  }

  await txToPromise(tx);
};

export const clearCachedUserScope = async (userScope: string): Promise<void> => {
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(
    [ACTIVITIES_STORE, PHOTOS_STORE, SYNC_META_STORE],
    'readwrite',
  );

  const activityIndex = tx
    .objectStore(ACTIVITIES_STORE)
    .index('by_user_scope');
  const activityKeys = await requestToPromise(
    activityIndex.getAllKeys(userScope),
  );
  for (const key of activityKeys) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    tx.objectStore(ACTIVITIES_STORE).delete(key);
  }

  const photoIndex = tx.objectStore(PHOTOS_STORE).index('by_user_scope');
  const photoKeys = await requestToPromise(
    photoIndex.getAllKeys(userScope),
  );
  for (const key of photoKeys) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    tx.objectStore(PHOTOS_STORE).delete(key);
  }

  // eslint-disable-next-line drizzle/enforce-delete-with-where
  tx.objectStore(SYNC_META_STORE).delete(userScope);

  await txToPromise(tx);
};

export const getSyncMeta = async (
  userScope: string,
): Promise<OfflineSyncMeta | null> => {
  const db = await openDatabase();
  if (!db) return null;

  const tx = db.transaction(SYNC_META_STORE, 'readonly');
  const store = tx.objectStore(SYNC_META_STORE);
  const meta = await requestToPromise(
    store.get(userScope),
  ) as OfflineSyncMeta | undefined;
  await txToPromise(tx);
  return meta ?? null;
};

export const setSyncMeta = async (
  meta: OfflineSyncMeta,
): Promise<void> => {
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(SYNC_META_STORE, 'readwrite');
  tx.objectStore(SYNC_META_STORE).put(meta);
  await txToPromise(tx);
};

export const getAppMeta = async (key: string): Promise<string | null> => {
  const db = await openDatabase();
  if (!db) return null;

  const tx = db.transaction(APP_META_STORE, 'readonly');
  const value = await requestToPromise(
    tx.objectStore(APP_META_STORE).get(key),
  ) as AppMetaRecord | undefined;
  await txToPromise(tx);
  return value?.value ?? null;
};

export const setAppMeta = async (
  key: string,
  value: string,
): Promise<void> => {
  const db = await openDatabase();
  if (!db) return;

  const tx = db.transaction(APP_META_STORE, 'readwrite');
  tx.objectStore(APP_META_STORE).put({ key, value } satisfies AppMetaRecord);
  await txToPromise(tx);
};
