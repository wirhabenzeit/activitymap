'use client';

import type { PhotoDTO } from '~/contracts/v1/photo';

import { drainSyncBootstrap } from './v1-client';
import {
  deletePhotoDTOsByIds,
  getCachedPhotoDTOs,
  upsertPhotoDTOs,
} from './v1-store';

/**
 * Photos for live library owners. Convex does not store photos, and a live
 * session replaces the REST sync that used to download them, so the photo
 * list is read from the REST bootstrap's `photos` resource (which needs no
 * snapshot of its own) and reconciled with the browser store: changed and new
 * photos are written, and photos the server no longer lists are removed.
 * Preview owners are served an empty list, as before.
 *
 * `commit` runs the store write through the scope's library writer, so it is
 * serialized with live batches and edit responses and fenced by account
 * cleanup. Returns whether the store changed.
 */
export async function syncLivePhotos(options: {
  scope: string;
  signal: AbortSignal;
  commit: (write: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  drain?: typeof drainSyncBootstrap;
  store?: {
    getCachedPhotoDTOs: typeof getCachedPhotoDTOs;
    upsertPhotoDTOs: typeof upsertPhotoDTOs;
    deletePhotoDTOsByIds: typeof deletePhotoDTOsByIds;
  };
}): Promise<boolean> {
  const { scope, signal } = options;
  const drain = options.drain ?? drainSyncBootstrap;
  const store = options.store ?? {
    getCachedPhotoDTOs,
    upsertPhotoDTOs,
    deletePhotoDTOsByIds,
  };
  const listed = new Map<string, PhotoDTO>();
  await drain(
    'photos',
    (page) => {
      if (page.resource !== 'photos') return;
      for (const photo of page.items) listed.set(photo.unique_id, photo);
    },
    { signal },
  );
  let changed = false;
  await options.commit(async (writer) => {
    writer.throwIfAborted();
    signal.throwIfAborted();
    const held = new Map(
      (await store.getCachedPhotoDTOs(scope)).map((photo) => [
        photo.unique_id,
        JSON.stringify(photo),
      ]),
    );
    const upserts = [...listed.values()].filter(
      (photo) => held.get(photo.unique_id) !== JSON.stringify(photo),
    );
    const removed = [...held.keys()].filter((id) => !listed.has(id));
    writer.throwIfAborted();
    await store.upsertPhotoDTOs(scope, upserts);
    await store.deletePhotoDTOsByIds(scope, removed);
    changed = upserts.length > 0 || removed.length > 0;
  });
  return changed;
}
