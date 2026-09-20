'use client';

import { useCallback, useEffect, useRef } from 'react';

import { runV1Sync } from '~/lib/sync/v1-sync';
import { checkSyncParityOnce } from '~/lib/sync/legacy-parity';
import { useShallowStore } from '~/store';

/**
 * Issue #126 (phase 2 cutover): this used to call the legacy
 * `~/lib/offline/sync.ts`'s `syncOfflineData` (`/api/offline/bootstrap` /
 * `/api/offline/changes`, the timestamp-cursor protocol #122 was filed to
 * fix). It now runs the v1 sync protocol via `runV1Sync`
 * (`/api/v1/sync/bootstrap` / `/api/v1/sync/changes`). The legacy routes
 * and `~/server/application/sync.ts` are intentionally left in place and
 * untouched on the server - this PR only cuts the client over - and are
 * removed in the follow-up phase 3 PR once this cutover's parity checks
 * (`~/lib/sync/legacy-cutover-parity.test.ts`, `~/lib/sync/legacy-parity.ts`)
 * have had a chance to be observed.
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
      .then(() => checkSyncParityOnce(scope))
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
