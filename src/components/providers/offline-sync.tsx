'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

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
import { runV1Sync } from '~/lib/sync/v1-sync';
import { useShallowStore } from '~/store';

/** Owns authenticated network writes. Views observe committed library snapshots. */
export function OfflineSyncProvider() {
  const previousUserIdRef = useRef<string | undefined>(undefined);
  const summaryRetryAtRef = useRef(new Map<string, number>());
  const summariesRef = useRef(new Map<string, Promise<void>>());
  const queryClient = useQueryClient();
  const { userId, isInitialized, isGuest, initializeAuth } = useShallowStore(
    (state) => ({
      userId: state.user?.id,
      isInitialized: state.isInitialized,
      isGuest: state.isGuest,
      initializeAuth: state.initializeAuth,
    }),
  );

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
          onActivityChanges: async (changes) => {
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

        // Profiles are optional resumable follow-up work. A library refresh must
        // not wait for every profile in a large account to download.
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
                    (current) =>
                      mergeStoredStreamSummaryResult(current, result),
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
                await removeStreamSummaryScope(
                  queryClient,
                  currentUserId,
                ).catch(() => undefined);
                if (isCurrent()) initializeAuth({ currentUser: null });
                return;
              }
              summaryRetryAtRef.current.set(
                currentUserId,
                error instanceof StreamSummaryBatchError &&
                  error.retryAt !== null
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
    [initializeAuth, queryClient],
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
    const unregister = registerLibrarySync(queryClient, scope, (signal) =>
      runSync(activeUserId, signal),
    );
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
    const sync = () => {
      void requestLibrarySync(queryClient, scope).catch(() => undefined);
    };
    const offline = () =>
      updateBrowserSyncStatus(activeUserId, { phase: 'offline' });
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', offline);
    window.addEventListener('activitymap:retry-browser-sync', sync);
    return () => {
      mounted = false;
      unregister();
      releaseOwner();
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', offline);
      window.removeEventListener('activitymap:retry-browser-sync', sync);
      // Preserve the owner on ordinary remounts (including Strict Mode); hooks
      // retain its subscription and cached reopen must retain persisted rows.
    };
  }, [clearAccount, isGuest, isInitialized, queryClient, runSync, userId]);

  return null;
}
