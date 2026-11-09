'use client';

import type { QueryClient } from '@tanstack/react-query';

import { authClient } from '~/lib/auth-client';

import { type LiveClient, LiveLibrary, createLiveClient } from './convex-live';
import { LibrarySyncNotReadyError, registerLibrarySync } from './library-sync';
import { setLiveDetailLoader } from './live-detail';
import {
  type SignalledLiveStore,
  coordinatedLiveStore,
  observedLiveStore,
} from './live-store';
import {
  type V1SyncState,
  applyV1SyncPage,
  getCachedActivityDTOs,
  getV1SyncState,
} from './v1-store';
import type { V1ActivityStreamChange } from './v1-sync';

// The REST sync takes over if the library is not usable by then: resumed
// from the stored position, or its first page loaded.
export const LIVE_FIRST_PAGE_TIMEOUT_MS = 20_000;

/** The browser library store for one scope, as the live session uses it. */
function indexedDbLiveStore(scope: string): SignalledLiveStore {
  return {
    cursor: async (signal) => {
      signal.throwIfAborted();
      const state = await getV1SyncState(scope);
      return state?.bootstrapComplete ? (state.live ?? null) : null;
    },
    apply: async ({ upserts, deletes, cursor, matchingVersion }, signal) => {
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
        { signal },
      );
    },
    heldIds: async (signal) => {
      signal.throwIfAborted();
      return (await getCachedActivityDTOs(scope)).map((item) => item.id);
    },
  };
}

/** The library writer ended this session (account retired or replaced). */
const fenced = (error: Error) =>
  error.name === 'AbortError' || error instanceof LibrarySyncNotReadyError;

/**
 * Run a live preview owner's library from Convex: resume the browser library
 * store from its change-feed position (or load it once) and follow new
 * changes. Convex pushes changes, so nothing polls. The session registers as
 * the scope's library writer, and every store read and write runs through
 * that writer, serialized with edit responses and fenced by account cleanup.
 * Any failure (token rejected, query error, not ready in time) stops the
 * session and calls `fallBack`; being fenced only stops it.
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
  /** Activities were added or changed after the first catch-up. */
  onChange?: (signal: AbortSignal) => void;
  /** Activities committed to the store, with their stream metadata, so
   * chart data loaded for an earlier recording can be dropped. */
  onActivityChanges?: (
    changes: V1ActivityStreamChange[],
  ) => void | Promise<void>;
  fallBack: (error: Error) => void;
  client?: LiveClient;
  timeoutMs?: number;
}): () => void {
  const { scope } = options;
  const session = new AbortController();
  let stopped = false;
  let completed = false;
  let live: LiveLibrary | null = null;
  // Registered first: store operations below run through this writer.
  const unregister = registerLibrarySync(options.queryClient, scope, () =>
    options.refresh(),
  );
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timeout);
    session.abort();
    setLiveDetailLoader(scope, null);
    unregister();
    live?.dispose();
  };
  const fail = (error: Error) => {
    if (stopped) return;
    stop();
    if (!fenced(error)) options.fallBack(error);
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
    coordinatedLiveStore(
      options.queryClient,
      scope,
      observedLiveStore(indexedDbLiveStore(scope), async (changes) => {
        if (!stopped && options.isCurrent())
          await options.onActivityChanges?.(changes);
      }),
    ),
    {
      onReady: () => window.clearTimeout(timeout),
      onComplete: () => {
        if (stopped || !options.isCurrent()) return;
        options.refresh().then(
          () => {
            if (stopped || !options.isCurrent()) return;
            completed = true;
            options.onComplete(session.signal);
          },
          (error: unknown) =>
            fail(error instanceof Error ? error : new Error(String(error))),
        );
      },
      onChange: () => {
        if (completed && !stopped && options.isCurrent())
          options.onChange?.(session.signal);
      },
      onError: fail,
    },
  );
  const current = live;
  setLiveDetailLoader(scope, (id) => current.activity(id));
  return stop;
}
