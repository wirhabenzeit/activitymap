/** Real IndexedDB seed/inspection helpers for the composed browser proof. */
import { activityDTOSchema } from '~/contracts/v1/activity';
import { photoDTOSchema } from '~/contracts/v1/photo';

import fixtures from '../../../shared/sync-integrity-fixtures.v1.json';
import {
  type V1SyncMutation,
  applyV1SyncPage,
  clearV1Scope,
  getCachedActivityDTOs,
  getCachedPhotoDTOs,
  getV1SyncState,
  subscribeV1LibraryCommits,
} from './v1-store';

export const libraryActivity = (id: string, name: string) =>
  activityDTOSchema.parse({ ...fixtures.activity, id, name });
export const libraryPhoto = (id: string, activityId: string, caption: string) =>
  photoDTOSchema.parse({
    ...fixtures.photo,
    unique_id: id,
    activity_id: activityId,
    caption,
  });

export async function seedLibrary(
  userId: string,
  cursor: string,
  activityId: string,
  name: string,
) {
  const scope = `auth:${userId}`;
  const activity = libraryActivity(activityId, name);
  const photo = libraryPhoto(
    `photo:${activityId}`,
    activityId,
    `${name} photo`,
  );
  const mutations: V1SyncMutation[] = [
    {
      sequence: '1',
      entityType: 'activity',
      operation: 'upsert',
      id: activity.id,
      activity,
    },
    {
      sequence: '2',
      entityType: 'photo',
      operation: 'upsert',
      id: photo.unique_id,
      photo,
    },
  ];
  await clearV1Scope(scope);
  await applyV1SyncPage(scope, mutations, {
    scope,
    bootstrapCursor: cursor,
    bootstrapComplete: true,
    changesCursor: cursor,
    lastSyncAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  });
}

export const clearLibrary = (userId: string) => clearV1Scope(`auth:${userId}`);

export async function inspectLibrary(userId: string) {
  const scope = `auth:${userId}`;
  const [activities, photos, state] = await Promise.all([
    getCachedActivityDTOs(scope),
    getCachedPhotoDTOs(scope),
    getV1SyncState(scope),
  ]);
  return {
    activities: activities.map(({ id, name }) => ({ id, name })),
    photos: photos.map(({ unique_id, activity_id, caption }) => ({
      id: unique_id,
      activityId: activity_id,
      caption,
    })),
    state,
  };
}

/** Abort the real page transaction after activity writes are queued. */
export async function abortLibraryCommit(userId: string) {
  const scope = `auth:${userId}`;
  const before = await inspectLibrary(userId);
  if (!before.state)
    throw new Error('Seed a complete library before the abort check');
  let notifications = 0;
  let aborts = 0;
  let failed = false;
  const unsubscribe = subscribeV1LibraryCommits((event) => {
    if (event.scope === scope) notifications++;
  });
  // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked via call(this).
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name === 'sync_state') {
      aborts++;
      this.transaction.abort();
      throw new DOMException('Fixture transaction abort', 'AbortError');
    }
    return key === undefined
      ? originalPut.call(this, value)
      : originalPut.call(this, value, key);
  };
  try {
    const activity = libraryActivity('999', 'Aborted ghost');
    await applyV1SyncPage(
      scope,
      [
        {
          sequence: '999',
          entityType: 'activity',
          operation: 'upsert',
          id: activity.id,
          activity,
        },
      ],
      before.state,
    );
  } catch {
    failed = true;
  } finally {
    IDBObjectStore.prototype.put = originalPut;
    unsubscribe();
  }
  return {
    failed,
    aborts,
    notifications,
    before,
    after: await inspectLibrary(userId),
  };
}
