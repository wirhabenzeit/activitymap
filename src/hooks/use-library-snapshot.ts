'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { useBrowserSyncStatus } from '~/lib/sync/browser-status';
import {
  authenticatedLibraryScope,
  getLibraryOwner,
} from '~/lib/sync/library-owner';
import { requestLibrarySync } from '~/lib/sync/library-sync';
import { useShallowStore } from '~/store';

const subscribeToNothing = () => () => undefined;
const noSnapshot = () => null;

/** The owner publishes the same committed snapshot to React Query and these
 * subscribers. Hooks never fetch or persist authenticated library pages. */
export function useLibrarySnapshot() {
  const client = useQueryClient();
  const userId = useShallowStore((state) =>
    state.isInitialized && !state.isGuest ? state.user?.id : undefined,
  );
  const scope = userId ? authenticatedLibraryScope(userId) : null;
  const owner = useMemo(
    () => (scope ? getLibraryOwner(client, scope) : null),
    [client, scope],
  );
  const snapshot = useSyncExternalStore(
    owner?.subscribe ?? subscribeToNothing,
    owner?.getSnapshot ?? noSnapshot,
    owner?.getServerSnapshot ?? noSnapshot,
  );
  const sync = useBrowserSyncStatus((state) =>
    userId ? state.byUser[userId] : undefined,
  );
  useEffect(() => {
    void owner?.load().catch(() => undefined);
  }, [owner]);
  const refetch = useCallback(async () => {
    if (scope) await requestLibrarySync(client, scope);
  }, [client, scope]);
  return { snapshot, sync, scope, refetch };
}
