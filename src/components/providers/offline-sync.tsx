'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  updateBrowserSyncStatus,
  useBrowserSyncStatus,
} from '~/lib/sync/browser-status';
import { SyncApiError } from '~/lib/sync/v1-client';
import { getV1SyncState } from '~/lib/sync/v1-store';
import { deleteLegacyOfflineDatabase } from '~/lib/sync/v1-store';
import { runV1Sync } from '~/lib/sync/v1-sync';
import { useShallowStore } from '~/store';
import {
  reconcileStreamSummaryMetadata,
  reloadStreamSummaryScope,
  removeStreamSummaryActivity,
  removeStreamSummaryScope,
} from '~/lib/activity-stream-summary';

/**
 * Runs the v1 sync protocol (`/api/v1/sync/bootstrap` / `/api/v1/sync/changes`,
 * see `~/lib/sync/v1-sync.ts`) in the background for the signed-in user.
 *
 * Issue #126 migrated this off a legacy timestamp-cursor protocol
 * (`/api/offline/bootstrap` / `/api/offline/changes`, removed in that
 * issue's phase 3) in three stacked PRs: additive adapters, this cutover,
 * then the legacy removal - see that issue for the full history and the
 * parity checks that preceded the removal.
 */
export function OfflineSyncProvider() {
  const inFlightRef = useRef<{
    controller: AbortController;
    promise: Promise<void>;
    token: symbol;
    userId: string;
  } | null>(null);
  const previousUserIdRef = useRef<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const { userId, isInitialized, isGuest } = useShallowStore((state) => ({
    userId: state.user?.id,
    isInitialized: state.isInitialized,
    isGuest: state.isGuest,
  }));

  const runSync = useCallback(() => {
    if (!isInitialized || isGuest || !userId) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      updateBrowserSyncStatus(userId, { phase: 'offline' });
      return;
    }
    const retryAt = useBrowserSyncStatus.getState().byUser[userId]?.retryAt;
    if (retryAt && retryAt > Date.now()) return;
    if (
      inFlightRef.current?.userId === userId &&
      !inFlightRef.current.controller.signal.aborted
    )
      return;
    const preceding = inFlightRef.current?.promise;
    inFlightRef.current?.controller.abort();

    const scope = `auth:${userId}`;
    const controller = new AbortController();
    const token = Symbol(userId);
    updateBrowserSyncStatus(userId, {
      phase: 'syncing',
      error: null,
      retryAt: null,
    });
    // Let an aborted pass finish its pending cache writes before starting another.
    const promise = Promise.resolve(preceding)
      .then(() => {
        controller.signal.throwIfAborted();
        return runV1Sync({
          scope,
          signal: controller.signal,
          onScopeReset: () => reloadStreamSummaryScope(queryClient, userId),
          onActivityChanges: async (changes) => {
            for (const change of changes) {
              if (change.operation === 'delete') {
                await removeStreamSummaryActivity(
                  queryClient,
                  userId,
                  change.activityId,
                );
              } else {
                await reconcileStreamSummaryMetadata(
                  queryClient,
                  userId,
                  change.activityId,
                  change.metadata,
                );
              }
            }
          },
        });
      })
      .then(async () => {
        if (controller.signal.aborted) return;
        updateBrowserSyncStatus(userId, {
          phase: 'ready',
          lastSuccess: new Date().toISOString(),
          error: null,
        });
        const cleanup = await deleteLegacyOfflineDatabase();
        if (cleanup === 'blocked' || cleanup === 'failed') {
          console.warn(
            `Legacy offline cache cleanup ${cleanup}; it will be retried.`,
          );
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        updateBrowserSyncStatus(userId, {
          phase: navigator.onLine ? 'error' : 'offline',
          error:
            error instanceof SyncApiError && error.status === 401
              ? 'Sign in again to download ActivityMap changes.'
              : 'Could not download ActivityMap changes. Your cached data remains available; retry when connected.',
          retryAt: error instanceof SyncApiError ? error.retryAt : null,
        });
      })
      .finally(() => {
        if (inFlightRef.current?.token === token) {
          inFlightRef.current = null;
        }
      });
    inFlightRef.current = { controller, promise, token, userId };
  }, [isInitialized, isGuest, queryClient, userId]);

  useEffect(() => {
    const previous = previousUserIdRef.current;
    previousUserIdRef.current = !isGuest ? userId : undefined;
    if (previous && (previous !== userId || isGuest)) {
      inFlightRef.current?.controller.abort();
      void removeStreamSummaryScope(queryClient, previous);
    }
  }, [isGuest, queryClient, userId]);

  useEffect(() => {
    runSync();
    return () => {
      inFlightRef.current?.controller.abort();
    };
  }, [runSync]);

  useEffect(() => {
    if (!userId || isGuest) return;
    let cancelled = false;
    void getV1SyncState(`auth:${userId}`)
      .then((state) => {
        if (
          !cancelled &&
          state?.lastSyncAt &&
          !useBrowserSyncStatus.getState().byUser[userId]?.lastSuccess
        ) {
          updateBrowserSyncStatus(userId, { lastSuccess: state.lastSyncAt });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, isGuest]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      runSync();
    };
    const handleOffline = () => {
      if (userId && !isGuest)
        updateBrowserSyncStatus(userId, { phase: 'offline' });
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('activitymap:retry-browser-sync', runSync);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('activitymap:retry-browser-sync', runSync);
    };
  }, [runSync, userId, isGuest]);

  return null;
}
