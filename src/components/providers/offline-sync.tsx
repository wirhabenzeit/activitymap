'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import type { PhotoDTO } from '~/contracts/v1/photo';
import {
  ACCOUNT_DELETED_STORAGE_KEY,
  clearDeletedAccountData,
  registerAccountDeletionCleanup,
} from '~/lib/account-deletion';
import {
  StreamSummaryBatchError,
  type StreamSummaryResult,
  mergeStoredStreamSummaryResult,
  reconcileStreamSummaryMetadata,
  reloadStreamSummaryScope,
  removeStreamSummaryActivity,
  removeStreamSummaryScope,
  streamSummaryQueryKey,
} from '~/lib/activity-stream-summary';
import {
  clearBrowserSyncStatus,
  updateBrowserSyncStatus,
  useBrowserSyncStatus,
} from '~/lib/sync/browser-status';
import {
  authenticatedLibraryScope,
  disposeLibraryScope,
  getLibraryOwner,
} from '~/lib/sync/library-owner';
import {
  registerLibrarySync,
  requestLibrarySync,
  retireLibrarySync,
} from '~/lib/sync/library-sync';
import { syncLivePhotos } from '~/lib/sync/live-photos';
import { startLiveSession } from '~/lib/sync/live-session';
import {
  clearStreamSummarySyncAttempts,
  syncStoredStreamSummaries,
} from '~/lib/sync/stream-summary-sync';
import { SyncApiError } from '~/lib/sync/v1-client';
import {
  OfflineCacheUpgradeBlockedError,
  clearV1Scope,
  deleteLegacyOfflineDatabase,
} from '~/lib/sync/v1-store';
import { type V1ActivityStreamChange, runV1Sync } from '~/lib/sync/v1-sync';
import { useShallowStore } from '~/store';

const LIBRARY_SYNC_INTERVAL_MS = 2 * 60_000;

/** Owns authenticated network writes. Views observe committed library snapshots. */
export function OfflineSyncProvider() {
  const previousUserIdRef = useRef<string | undefined>(undefined);
  const summaryRetryAtRef = useRef(new Map<string, number>());
  const summariesRef = useRef(new Map<string, Promise<void>>());
  const queryClient = useQueryClient();
  const { userId, convexLiveUrl, isInitialized, isGuest, initializeAuth } =
    useShallowStore((state) => ({
      userId: state.user?.id,
      convexLiveUrl: state.user?.convexLive?.url,
      isInitialized: state.isInitialized,
      isGuest: state.isGuest,
      initializeAuth: state.initializeAuth,
    }));

  const clearAccount = useCallback(
    (departingUserId: string) => {
      const scope = authenticatedLibraryScope(departingUserId);
      disposeLibraryScope(queryClient, scope);
      clearBrowserSyncStatus(departingUserId);
      return retireLibrarySync(queryClient, scope, async () => {
        // The coordinator has aborted and drained the writer before erasing disk.
        await summariesRef.current.get(departingUserId);
        clearStreamSummarySyncAttempts(departingUserId);
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
        summaryRetryAtRef.current.delete(departingUserId);
        await removeStreamSummaryScope(queryClient, departingUserId);
        await clearV1Scope(scope);
        const queries = {
          predicate: (query: { queryKey: readonly unknown[] }) =>
            [
              'first-summary-fetch',
              'first-summary-import',
              'ingestion-status',
              'strava-import',
            ].includes(String(query.queryKey[0])) &&
            query.queryKey[1] === departingUserId,
        };
        await queryClient.cancelQueries(queries);
        queryClient.removeQueries(queries);
      });
    },
    [queryClient],
  );

  // Profiles are optional resumable follow-up work. A library refresh must
  // not wait for every profile in a large account to download.
  const startSummarySync = useCallback(
    (currentUserId: string, signal: AbortSignal, isCurrent: () => boolean) => {
      if (
        !summariesRef.current.has(currentUserId) &&
        (summaryRetryAtRef.current.get(currentUserId) ?? 0) <= Date.now()
      ) {
        const task = syncStoredStreamSummaries({
          userId: currentUserId,
          signal,
          onResults: (results) => {
            if (!isCurrent()) return;
            for (const [id, result] of results) {
              const queryKey = streamSummaryQueryKey(currentUserId, id);
              if (queryClient.getQueryState(queryKey)) {
                queryClient.setQueryData<StreamSummaryResult>(
                  queryKey,
                  (current) => mergeStoredStreamSummaryResult(current, result),
                );
              }
            }
          },
        })
          .then(() => {
            // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
            summaryRetryAtRef.current.delete(currentUserId);
          })
          .catch(async (error: unknown) => {
            if (!isCurrent()) return;
            if (
              error instanceof StreamSummaryBatchError &&
              error.status === 401
            ) {
              await removeStreamSummaryScope(queryClient, currentUserId).catch(
                () => undefined,
              );
              if (isCurrent()) initializeAuth({ currentUser: null });
              return;
            }
            summaryRetryAtRef.current.set(
              currentUserId,
              error instanceof StreamSummaryBatchError && error.retryAt !== null
                ? error.retryAt
                : Date.now() + 60_000,
            );
            console.warn(
              'Profile downloads paused; missing summaries will be retried on the next sync.',
              error,
            );
          })
          .finally(() => {
            if (summariesRef.current.get(currentUserId) === task) {
              // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
              summariesRef.current.delete(currentUserId);
            }
          });
        summariesRef.current.set(currentUserId, task);
      }
    },
    [initializeAuth, queryClient],
  );

  // Chart data held in memory belongs to the stream metadata it was loaded
  // for: drop it when a synced activity's recording changed or it was deleted.
  const reconcileSummaries = useCallback(
    async (
      currentUserId: string,
      changes: V1ActivityStreamChange[],
      checkCurrent: () => void,
    ) => {
      for (const change of changes) {
        checkCurrent();
        if (change.operation === 'delete') {
          await removeStreamSummaryActivity(
            queryClient,
            currentUserId,
            change.activityId,
          );
        } else {
          await reconcileStreamSummaryMetadata(
            queryClient,
            currentUserId,
            change.activityId,
            change.metadata,
          );
        }
      }
    },
    [queryClient],
  );

  const runSync = useCallback(
    async (currentUserId: string, signal: AbortSignal) => {
      const isCurrent = () =>
        !signal.aborted &&
        useShallowStore.getState().user?.id === currentUserId &&
        !useShallowStore.getState().isGuest;
      const checkCurrent = () => {
        signal.throwIfAborted();
        if (!isCurrent())
          throw new DOMException('The library session changed', 'AbortError');
      };
      checkCurrent();
      if (!navigator.onLine) {
        updateBrowserSyncStatus(currentUserId, { phase: 'offline' });
        throw new Error('Connect to the internet to sync your library.');
      }
      const retryAt =
        useBrowserSyncStatus.getState().byUser[currentUserId]?.retryAt;
      if (retryAt && retryAt > Date.now())
        throw new Error('Library sync is waiting before retrying.');
      const scope = authenticatedLibraryScope(currentUserId);
      updateBrowserSyncStatus(currentUserId, {
        phase: 'syncing',
        error: null,
        retryAt: null,
      });
      try {
        await runV1Sync({
          scope,
          signal,
          onScopeReset: () => {
            checkCurrent();
            clearStreamSummarySyncAttempts(currentUserId);
            return reloadStreamSummaryScope(queryClient, currentUserId);
          },
          onActivityChanges: (changes) =>
            reconcileSummaries(currentUserId, changes, checkCurrent),
        });
        checkCurrent();
        const owner = getLibraryOwner(queryClient, scope);
        await owner.refresh();
        checkCurrent();
        updateBrowserSyncStatus(currentUserId, {
          phase: 'ready',
          lastSuccess:
            owner.getSnapshot().syncState?.lastSyncAt ??
            new Date().toISOString(),
          error: null,
        });
        void deleteLegacyOfflineDatabase()
          .then((result) => {
            if (result === 'blocked' || result === 'failed')
              console.warn(
                `Legacy offline cache cleanup ${result}; it will be retried.`,
              );
          })
          .catch(() => undefined);

        startSummarySync(currentUserId, signal, isCurrent);
      } catch (error) {
        if (isCurrent()) {
          updateBrowserSyncStatus(currentUserId, {
            phase: navigator.onLine ? 'error' : 'offline',
            error:
              error instanceof OfflineCacheUpgradeBlockedError
                ? error.message
                : error instanceof SyncApiError && error.status === 401
                  ? 'Sign in again to download ActivityMap changes.'
                  : 'Could not download ActivityMap changes. Your cached data remains available; retry when connected.',
            retryAt: error instanceof SyncApiError ? error.retryAt : null,
          });
          if (error instanceof SyncApiError && error.status === 401)
            initializeAuth({ currentUser: null });
        }
        throw error;
      }
    },
    [initializeAuth, queryClient, reconcileSummaries, startSummarySync],
  );

  useEffect(() => {
    const unregister = registerAccountDeletionCleanup(async (deletedUserId) => {
      const pending = clearAccount(deletedUserId);
      if (useShallowStore.getState().user?.id === deletedUserId) {
        previousUserIdRef.current = undefined;
        initializeAuth({ currentUser: null });
      }
      await pending;
    });
    const onDeletion = (event: StorageEvent) => {
      if (event.key !== ACCOUNT_DELETED_STORAGE_KEY || !event.newValue) return;
      try {
        const value: unknown = JSON.parse(event.newValue);
        if (
          typeof value === 'object' &&
          value &&
          'userId' in value &&
          typeof value.userId === 'string'
        ) {
          void clearDeletedAccountData(value.userId).catch(() => undefined);
        }
      } catch {
        /* Ignore malformed cross-tab notifications. */
      }
    };
    window.addEventListener('storage', onDeletion);
    return () => {
      unregister();
      window.removeEventListener('storage', onDeletion);
    };
  }, [clearAccount, initializeAuth]);

  useEffect(() => {
    const activeUserId = isInitialized && !isGuest ? userId : undefined;
    const previous = previousUserIdRef.current;
    previousUserIdRef.current = activeUserId;
    if (previous && previous !== activeUserId)
      void clearAccount(previous).catch(() => undefined);
    if (!activeUserId) return;

    const scope = authenticatedLibraryScope(activeUserId);
    const owner = getLibraryOwner(queryClient, scope);
    const releaseOwner = owner.retain();
    let mounted = true;
    void owner
      .load()
      .then(() => {
        const lastSuccess = owner.getSnapshot().syncState?.lastSyncAt;
        if (
          mounted &&
          useShallowStore.getState().user?.id === activeUserId &&
          lastSuccess &&
          !useBrowserSyncStatus.getState().byUser[activeUserId]?.lastSuccess
        )
          updateBrowserSyncStatus(activeUserId, { lastSuccess });
      })
      .catch(() => undefined);

    // The REST sync: bootstrap, then poll the change feed.
    const startRest = () => {
      const unregister = registerLibrarySync(queryClient, scope, (signal) =>
        runSync(activeUserId, signal),
      );
      const sync = () => {
        void requestLibrarySync(queryClient, scope).catch(() => undefined);
      };
      const offline = () =>
        updateBrowserSyncStatus(activeUserId, { phase: 'offline' });
      // Backend jobs publish encounters and other server-side changes through
      // the changes feed; poll it gently while the page is visible.
      const syncVisible = () => {
        if (document.visibilityState === 'visible') sync();
      };
      const interval = window.setInterval(
        syncVisible,
        LIBRARY_SYNC_INTERVAL_MS,
      );
      sync();
      document.addEventListener('visibilitychange', syncVisible);
      window.addEventListener('online', sync);
      window.addEventListener('offline', offline);
      window.addEventListener('activitymap:retry-browser-sync', sync);
      return () => {
        unregister();
        window.clearInterval(interval);
        document.removeEventListener('visibilitychange', syncVisible);
        window.removeEventListener('online', sync);
        window.removeEventListener('offline', offline);
        window.removeEventListener('activitymap:retry-browser-sync', sync);
      };
    };

    // Live preview owners read from Convex; any failure falls back to REST.
    const stops: (() => void)[] = [];
    const startLive = (url: string) => {
      // Convex pushes library changes, but profile downloads still need the
      // REST sync's triggers: after new activities, and as retries.
      let liveSignal: AbortSignal | null = null;
      const summaries = () => {
        if (liveSignal && !liveSignal.aborted)
          startSummarySync(activeUserId, liveSignal, () => mounted);
      };
      const summariesVisible = () => {
        if (document.visibilityState === 'visible') summaries();
      };
      // Photos are not part of the library feed: read the photo list from
      // Convex once the library is current, and again when the feed reports
      // photo changes. A request made during a run starts one more run after
      // it.
      let listPhotos: (() => Promise<PhotoDTO[]>) | null = null;
      let photosRunning = false;
      let photosRequested = false;
      const photos = () => {
        const signal = liveSignal;
        const list = listPhotos;
        if (!signal || signal.aborted || !list) return;
        if (photosRunning) {
          photosRequested = true;
          return;
        }
        photosRunning = true;
        photosRequested = false;
        void syncLivePhotos({
          scope,
          signal,
          list,
          commit: (write) => requestLibrarySync(queryClient, scope, write),
        })
          .catch((error: unknown) => {
            if (!signal.aborted)
              console.warn(
                'Photo download paused; it is retried with the next change.',
                error,
              );
          })
          .finally(() => {
            photosRunning = false;
            if (photosRequested) photos();
          });
      };
      const followUps = () => {
        summaries();
        photos();
      };
      const interval = window.setInterval(
        summariesVisible,
        LIBRARY_SYNC_INTERVAL_MS,
      );
      document.addEventListener('visibilitychange', summariesVisible);
      window.addEventListener('online', followUps);
      window.addEventListener('activitymap:retry-browser-sync', followUps);
      const stopTriggers = () => {
        liveSignal = null;
        listPhotos = null;
        window.clearInterval(interval);
        document.removeEventListener('visibilitychange', summariesVisible);
        window.removeEventListener('online', followUps);
        window.removeEventListener('activitymap:retry-browser-sync', followUps);
      };
      const stopSession = startLiveSession({
        url,
        scope,
        queryClient,
        refresh: () => owner.refresh(),
        isCurrent: () =>
          mounted &&
          useShallowStore.getState().user?.id === activeUserId &&
          !useShallowStore.getState().isGuest,
        onSyncing: () =>
          updateBrowserSyncStatus(activeUserId, {
            phase: 'syncing',
            error: null,
            retryAt: null,
          }),
        onComplete: (signal, photoList) => {
          updateBrowserSyncStatus(activeUserId, {
            phase: 'ready',
            lastSuccess: new Date().toISOString(),
            error: null,
          });
          liveSignal = signal;
          listPhotos = photoList;
          followUps();
        },
        onChange: summaries,
        onPhotoChange: photos,
        onActivityChanges: (changes) =>
          reconcileSummaries(activeUserId, changes, () => {
            if (!mounted)
              throw new DOMException(
                'The library session changed',
                'AbortError',
              );
          }),
        fallBack: (error) => {
          if (!mounted) return;
          console.warn('Live library unavailable; using the REST sync.', error);
          stopTriggers();
          stops.push(startRest());
        },
      });
      return () => {
        stopTriggers();
        stopSession();
      };
    };
    stops.push(convexLiveUrl ? startLive(convexLiveUrl) : startRest());
    return () => {
      mounted = false;
      for (const stop of stops) stop();
      releaseOwner();
      // Preserve the owner on ordinary remounts (including Strict Mode); hooks
      // retain its subscription and cached reopen must retain persisted rows.
    };
  }, [
    clearAccount,
    convexLiveUrl,
    isGuest,
    isInitialized,
    queryClient,
    reconcileSummaries,
    runSync,
    startSummarySync,
    userId,
  ]);

  return null;
}
