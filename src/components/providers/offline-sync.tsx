'use client';

import { useCallback, useEffect, useRef } from 'react';

import { deleteLegacyOfflineDatabase } from '~/lib/sync/v1-store';
import { runV1Sync } from '~/lib/sync/v1-sync';
import { useShallowStore } from '~/store';

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
  const inFlightRef = useRef<Promise<void> | null>(null);
  const { userId, isInitialized, isGuest } = useShallowStore((state) => ({
    userId: state.user?.id,
    isInitialized: state.isInitialized,
    isGuest: state.isGuest,
  }));

  const runSync = useCallback(() => {
    if (!isInitialized || isGuest || !userId) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (inFlightRef.current) return;

    const scope = `auth:${userId}`;
    inFlightRef.current = runV1Sync({ scope })
      .then(async () => {
        const cleanup = await deleteLegacyOfflineDatabase();
        if (cleanup === 'blocked' || cleanup === 'failed') {
          console.warn(`Legacy offline cache cleanup ${cleanup}; it will be retried.`);
        }
      })
      .catch((error: unknown) => {
        console.error('v1 sync failed:', error);
      })
      .finally(() => {
        inFlightRef.current = null;
      });
  }, [isInitialized, isGuest, userId]);

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
