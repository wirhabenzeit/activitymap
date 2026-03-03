'use client';

import { useCallback, useEffect, useRef } from 'react';

import { syncOfflineData } from '~/lib/offline/sync';
import { useShallowStore } from '~/store';

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

    inFlightRef.current = syncOfflineData({ userId })
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error('Offline sync failed:', error);
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
