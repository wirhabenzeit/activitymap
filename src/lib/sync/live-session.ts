'use client';

import type { QueryClient } from '@tanstack/react-query';

import { authClient } from '~/lib/auth-client';

import { type LiveClient, LiveLibrary, createLiveClient } from './convex-live';
import { registerLibrarySync } from './library-sync';
import { setLiveDetailLoader } from './live-detail';
import {
  deleteActivityDTOsByIds,
  getCachedActivityDTOs,
  setV1SyncState,
  upsertActivityDTOs,
} from './v1-store';

// The REST sync takes over if Convex has not delivered the first page by then.
export const LIVE_FIRST_PAGE_TIMEOUT_MS = 20_000;

/**
 * Run a live preview owner's library from Convex: subscribe, commit pages to
 * the browser library store and register as the scope's library writer.
 * Convex pushes changes, so nothing polls. Any failure (token rejected, query
 * error, no first page in time) stops the session and calls `fallBack`.
 * Returns a function that stops the session.
 */
export function startLiveSession(options: {
  url: string;
  scope: string;
  queryClient: QueryClient;
  /** Re-read the committed library snapshot. */
  refresh: () => Promise<void>;
  isCurrent: () => boolean;
  onSyncing: () => void;
  onComplete: (signal: AbortSignal) => void;
  fallBack: (error: Error) => void;
  client?: LiveClient;
  timeoutMs?: number;
}): () => void {
  const { scope } = options;
  const session = new AbortController();
  let stopped = false;
  let unregister: (() => void) | null = null;
  let live: LiveLibrary | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timeout);
    session.abort();
    setLiveDetailLoader(scope, null);
    unregister?.();
    live?.dispose();
  };
  const fail = (error: Error) => {
    if (stopped) return;
    stop();
    options.fallBack(error);
  };
  const timeout = window.setTimeout(
    () => fail(new Error('Convex did not deliver the first page')),
    options.timeoutMs ?? LIVE_FIRST_PAGE_TIMEOUT_MS,
  );
  options.onSyncing();
  const client =
    options.client ??
    createLiveClient(
      options.url,
      async () => (await authClient.token()).data?.token ?? null,
      (authenticated) => {
        if (!authenticated)
          fail(new Error('Convex did not accept the session token'));
      },
    );
  live = new LiveLibrary(
    client,
    {
      upsert: (items) => upsertActivityDTOs(scope, items),
      remove: (ids) => deleteActivityDTOsByIds(scope, ids),
      heldIds: async () =>
        (await getCachedActivityDTOs(scope)).map((item) => item.id),
      complete: async ({ placeMatchingVersion }) => {
        const now = new Date().toISOString();
        await setV1SyncState({
          scope,
          bootstrapCursor: null,
          bootstrapComplete: true,
          // No REST cursor: a later REST sync starts with a bootstrap.
          changesCursor: null,
          lastSyncAt: now,
          updatedAt: now,
          ...(placeMatchingVersion && { placeMatchingVersion }),
          placesSyncReady: true,
        });
        await options.refresh();
      },
    },
    {
      onFirstPage: () => window.clearTimeout(timeout),
      onComplete: () => {
        if (!stopped && options.isCurrent()) options.onComplete(session.signal);
      },
      onError: fail,
    },
  );
  const current = live;
  setLiveDetailLoader(scope, (id) => current.activity(id));
  // Edits commit their responses through the serialized library writer; a
  // "sync" here waits for the writes received so far.
  unregister = registerLibrarySync(options.queryClient, scope, async () => {
    await current.settled();
    await options.refresh();
  });
  return stop;
}
