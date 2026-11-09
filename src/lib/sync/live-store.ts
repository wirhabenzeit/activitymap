import type { QueryClient } from '@tanstack/react-query';

import type { LiveLibraryStore } from './convex-live';
import { requestLibrarySync } from './library-sync';
import type { V1ActivityStreamChange } from './v1-sync';

/** A live library store whose operations receive the library writer's signal. */
export type SignalledLiveStore = {
  [K in keyof LiveLibraryStore]: (
    ...args: [...Parameters<LiveLibraryStore[K]>, signal: AbortSignal]
  ) => ReturnType<LiveLibraryStore[K]>;
};

/**
 * Route every live read and write of the browser library store through the
 * scope's serialized library writer (`library-sync.ts`), like REST downloads
 * and edit responses:
 *
 * - nothing runs before cleanup queued earlier (a departing account, or a
 *   rapid A -> B -> A switch) has erased what it must, so a new session never
 *   resumes from a position that cleanup is about to remove;
 * - once the scope is retired or registered again, operations reject with an
 *   abort instead of writing a retired account's library back to disk.
 *
 * Each operation resolves when its own commit has run, not when the writer's
 * pass ends with its snapshot refresh, so the refresh overlaps the next
 * network read. A later operation still waits for that refresh, as every
 * writer's next pass does.
 */
export function coordinatedLiveStore(
  client: QueryClient,
  scope: string,
  store: SignalledLiveStore,
): LiveLibraryStore {
  const commit = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      requestLibrarySync(client, scope, async (signal) => {
        signal.throwIfAborted();
        resolve(await operation(signal));
      }).catch(reject);
    });
  return {
    cursor: () => commit((signal) => store.cursor(signal)),
    apply: (change) => commit((signal) => store.apply(change, signal)),
    heldIds: () => commit((signal) => store.heldIds(signal)),
  };
}

/**
 * Report each committed batch's activities and their stream metadata, as the
 * REST sync does (`onActivityChanges`), so in-memory chart data loaded for an
 * earlier recording is dropped. The report runs after the batch's commit,
 * inside the same writer operation, and is skipped once the writer is fenced.
 */
export function observedLiveStore(
  store: SignalledLiveStore,
  onActivityChanges: (
    changes: V1ActivityStreamChange[],
  ) => void | Promise<void>,
): SignalledLiveStore {
  return {
    ...store,
    apply: async (change, signal) => {
      await store.apply(change, signal);
      signal.throwIfAborted();
      const changes: V1ActivityStreamChange[] = [
        ...change.upserts.map((activity) => ({
          activityId: activity.id,
          operation: 'upsert' as const,
          metadata: activity.streams,
        })),
        ...change.deletes.map((activityId) => ({
          activityId,
          operation: 'delete' as const,
        })),
      ];
      if (changes.length > 0) await onActivityChanges(changes);
    },
  };
}
