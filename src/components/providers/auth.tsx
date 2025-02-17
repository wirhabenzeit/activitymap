'use client';

import { useEffect } from 'react';
import { useShallowStore } from '~/store';
import type { Session } from 'next-auth';
import type { User, Account } from '~/server/db/schema';
import type { InitialAuth as InitialAuth } from '~/store/auth';

export function AuthProvider({
  initialAuth,
  children,
}: {
  initialAuth: InitialAuth;
  children: React.ReactNode;
}) {
  const {
    initializeAuth,
    loadFromDB,
    loadFromStrava,
    loadPhotos,
    session,
    user,
    account,
  } = useShallowStore((state) => ({
    initializeAuth: state.initializeAuth,
    loadFromDB: state.loadFromDB,
    loadFromStrava: state.loadFromStrava,
    loadPhotos: state.loadPhotos,
    session: state.session,
    user: state.user,
    account: state.account,
  }));

  useEffect(() => {
    if (initialAuth.session) {
      initializeAuth(initialAuth);

      // Load initial data
      loadFromDB({})
        .then((activityCount) => {
          // If no activities found in DB, fetch from Strava
          if (activityCount === 0) {
            return loadFromStrava({ photos: true });
          }
          return activityCount;
        })
        .catch(console.error);

      loadPhotos().catch(console.error);
    }
  }, [initialAuth, initializeAuth, loadFromDB, loadFromStrava, loadPhotos]);

  return <>{children}</>;
}
