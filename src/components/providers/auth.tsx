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
    loadFromDBBatched,
    loadPhotos,
    loadFromStrava,
    isInitialized,
    addNotification,
    user,
    account,
  } = useShallowStore((state) => ({
    initializeAuth: state.initializeAuth,
    loadFromDBBatched: state.loadFromDBBatched,
    loadPhotos: state.loadPhotos,
    loadFromStrava: state.loadFromStrava,
    isInitialized: state.isInitialized,
    addNotification: state.addNotification,
    user: state.user,
    account: state.account,
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

      // Load data based on mode
      if (initialAuth.guestMode) {

        if (
          initialAuth.guestMode.type === 'activities' &&
          initialAuth.guestMode.activityIds
        ) {
          loadFromDBBatched({ userId: undefined }).catch((error) => {
            console.error('Error loading activities in guest mode:', error);
            addNotification({
              type: 'error',
              title: 'Error loading activities',
              message: 'Failed to load shared activities.',
            });
          });
        } else if (
          initialAuth.guestMode.type === 'user' &&
          initialAuth.guestMode.userId
        ) {
          loadFromDBBatched({ userId: initialAuth.guestMode.userId }).catch(
            (error) => {
              console.error(
                'Error loading user activities in guest mode:',
                error,
              );
              addNotification({
                type: 'error',
                title: 'Error loading activities',
                message: 'Failed to load user activities.',
              });
            },
          );
        }
      } else if (initialAuth.session) {
        // Normal auth flow - load from DB initially

        loadFromDBBatched({ userId: user?.id }).catch((error) => {
          console.error('Error loading from DB:', error);
          addNotification({
            type: 'error',
            title: 'Error loading activities',
            message: 'Failed to load activities from database.',
          });
        });

        loadPhotos().catch((error) => {
          console.error('Error loading photos:', error);
        });
      }
    }
  }, [
    searchParams,
    initialAuth,
    isInitialized,
    initializeAuth,
    loadFromDBBatched,
    loadPhotos,
    loadFromStrava,
    addNotification,
    user,
    account,
  ]);

  return <>{children}</>;
}
