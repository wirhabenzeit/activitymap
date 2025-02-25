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
    loadFromDB,
    loadPhotos,
    isInitialized,
    addNotification,
    user,
    account,
  } = useShallowStore((state) => ({
    initializeAuth: state.initializeAuth,
    loadFromDB: state.loadFromDB,
    loadPhotos: state.loadPhotos,
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

        console.log('Initializing guest mode from URL params:', guestMode);
        initialAuth.guestMode = guestMode;
      }

      console.log('Auth initialization debug:', {
        hasSession: !!initialAuth.session,
        hasGuestMode: !!initialAuth.guestMode,
        guestModeType: initialAuth.guestMode?.type,
        initialAuthUser: initialAuth.user,
        initialAuthAccount: initialAuth.account,
        currentUser: user,
        currentAccount: account,
      });

      // Initialize the auth state
      initializeAuth(initialAuth);

      // Load data based on mode
      if (initialAuth.guestMode) {
        console.log('Loading guest mode data:', initialAuth.guestMode);
        if (
          initialAuth.guestMode.type === 'activities' &&
          initialAuth.guestMode.activityIds
        ) {
          loadFromDB({ publicIds: initialAuth.guestMode.activityIds }).catch(
            (error) => {
              console.error('Error loading activities in guest mode:', error);
              addNotification({
                type: 'error',
                title: 'Error loading activities',
                message: 'Failed to load shared activities.',
              });
            },
          );
        } else if (
          initialAuth.guestMode.type === 'user' &&
          initialAuth.guestMode.userId
        ) {
          loadFromDB({ userId: initialAuth.guestMode.userId }).catch(
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
        console.log('Starting normal auth flow DB load');
        loadFromDB({})
          .then((activityCount) => {
            console.log('DB load completed:', {
              activityCount,
              userId: user?.id,
              accountId: account?.providerAccountId,
            });
            if (activityCount === 0) {
              addNotification({
                type: 'info',
                title: 'No activities found',
                message:
                  'Click "Get Activities" in the user menu to fetch your activities from Strava.',
              });
            }
          })
          .catch((error) => {
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
    loadFromDB,
    loadPhotos,
    addNotification,
    user,
    account,
  ]);

  return <>{children}</>;
}
