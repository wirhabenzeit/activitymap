'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

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
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (inFlightRef.current?.userId === userId) return;
    inFlightRef.current?.controller.abort();

    const scope = `auth:${userId}`;
    const controller = new AbortController();
    const token = Symbol(userId);
    const promise = runV1Sync({
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
    })
      .then(async () => {
        const cleanup = await deleteLegacyOfflineDatabase();
        if (cleanup === 'blocked' || cleanup === 'failed') {
          console.warn(
            `Legacy offline cache cleanup ${cleanup}; it will be retried.`,
          );
        }
      })
      .catch((error: unknown) => {
        console.error('v1 sync failed:', error);
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
    if (previous && previous !== userId) {
      inFlightRef.current?.controller.abort();
      void removeStreamSummaryScope(queryClient, previous);
    }
  }, [isGuest, queryClient, userId]);

  useEffect(() => {
    runSync();
  }, [runSync]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      runSync();
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [runSync]);

  return null;
}
