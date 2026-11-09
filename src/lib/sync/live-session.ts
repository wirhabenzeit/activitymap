'use client';

import type { QueryClient } from '@tanstack/react-query';

import { authClient } from '~/lib/auth-client';

import { type LiveClient, LiveLibrary, createLiveClient } from './convex-live';
import { registerLibrarySync } from './library-sync';
import { setLiveDetailLoader } from './live-detail';
import {
  type V1SyncState,
  applyV1SyncPage,
  getCachedActivityDTOs,
  getV1SyncState,
} from './v1-store';

// The REST sync takes over if the library is not usable by then: resumed
// from the stored position, or its first page loaded.
export const LIVE_FIRST_PAGE_TIMEOUT_MS = 20_000;

/**
 * Run a live preview owner's library from Convex: resume the browser library
 * store from its change-feed position (or load it once), follow new changes
 * and register as the scope's library writer. Convex pushes changes, so
 * nothing polls. Any failure (token rejected, query
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
    () => fail(new Error('The live library was not ready in time')),
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
      cursor: async () => {
        const state = await getV1SyncState(scope);
        return state?.bootstrapComplete ? (state.live ?? null) : null;
      },
      apply: async ({ upserts, deletes, cursor, matchingVersion }) => {
        const previous = await getV1SyncState(scope);
        const now = new Date().toISOString();
        const state: V1SyncState = {
          scope,
          bootstrapCursor: null,
          bootstrapComplete: cursor
            ? true
            : (previous?.bootstrapComplete ?? false),
          // No REST cursor: a later REST sync starts with a bootstrap.
          changesCursor: null,
          lastSyncAt: cursor ? now : (previous?.lastSyncAt ?? null),
          updatedAt: now,
          placeMatchingVersion: matchingVersion,
          placesSyncReady: true,
          ...(cursor && { live: cursor }),
        };
        // Sequence numbers in these mutations are diagnostic only.
        const sequence = String(cursor?.sequence ?? 0);
        await applyV1SyncPage(
          scope,
          [
            ...upserts.map((activity) => ({
              sequence,
              entityType: 'activity' as const,
              operation: 'upsert' as const,
              id: activity.id,
              activity,
            })),
            ...deletes.map((id) => ({
              sequence,
              entityType: 'activity' as const,
              operation: 'delete' as const,
              id,
            })),
          ],
          state,
          { signal: session.signal },
        );
      },
      heldIds: async () =>
        (await getCachedActivityDTOs(scope)).map((item) => item.id),
    },
    {
      onReady: () => window.clearTimeout(timeout),
      onComplete: () => {
        if (stopped || !options.isCurrent()) return;
        options.refresh().then(
          () => {
            if (!stopped && options.isCurrent())
              options.onComplete(session.signal);
          },
          (error: unknown) =>
            fail(error instanceof Error ? error : new Error(String(error))),
        );
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
