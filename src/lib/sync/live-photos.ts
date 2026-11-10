'use client';

import type { PhotoDTO } from '~/contracts/v1/photo';

import {
  deletePhotoDTOsByIds,
  getCachedPhotoDTOs,
  upsertPhotoDTOs,
} from './v1-store';

/**
 * Photos for live library owners. A live session replaces the REST sync that
 * used to download them, so the photo list is read from Convex (`list`, the
 * whole list each time) and reconciled with the browser store: changed and
 * new photos are written, and photos Convex no longer lists are removed. The
 * session calls this once the library is current and whenever the change
 * feed reports photo changes.
 *
 * `commit` runs the store write through the scope's library writer, so it is
 * serialized with live batches and edit responses and fenced by account
 * cleanup. Returns whether the store changed.
 */
export async function syncLivePhotos(options: {
  scope: string;
  signal: AbortSignal;
  commit: (write: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  list: () => Promise<PhotoDTO[]>;
  store?: {
    getCachedPhotoDTOs: typeof getCachedPhotoDTOs;
    upsertPhotoDTOs: typeof upsertPhotoDTOs;
    deletePhotoDTOsByIds: typeof deletePhotoDTOsByIds;
  };
}): Promise<boolean> {
  const { scope, signal } = options;
  const store = options.store ?? {
    getCachedPhotoDTOs,
    upsertPhotoDTOs,
    deletePhotoDTOsByIds,
  };
  const listed = new Map(
    (await options.list()).map((photo) => [photo.unique_id, photo]),
  );
  signal.throwIfAborted();
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
