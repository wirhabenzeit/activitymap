'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useShallowStore } from '~/store';
import type { InitialAuth } from '~/store/auth';

export function AuthProvider({
  initialAuth,
  children,
}: {
  initialAuth: InitialAuth;
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const {
    initializeAuth,
    isInitialized,
  } = useShallowStore((state) => ({
    initializeAuth: state.initializeAuth,
    isInitialized: state.isInitialized,
  }));

  useEffect(() => {
    if (!isInitialized) {
      // Handle guest mode from search params
      const userParam = searchParams.get('user');
      const activitiesParam = searchParams.get('activities');

      if (userParam || activitiesParam) {
        const guestMode = {
          type: userParam ? 'user' : 'activities',
          userId: userParam ?? undefined,
          activityIds: activitiesParam
            ? activitiesParam
              .split(',')
              .map(Number)
              .filter((id) => !isNaN(id))
            : undefined,
        } as const;

        initialAuth.guestMode = guestMode;
      }

      // Initialize the auth state
      initializeAuth(initialAuth);

      // Note: Data fetching is now handled by TanStack Query hooks (useActivities, usePhotos)
      // in the components that need the data, rather than batched loading here.
    }
  }, [
    searchParams,
    initialAuth,
    isInitialized,
    initializeAuth,
  ]);

  return <>{children}</>;
}
