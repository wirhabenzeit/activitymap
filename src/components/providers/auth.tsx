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
    loadFromStrava,
    isInitialized,
    addNotification,
    user,
    account,
  } = useShallowStore((state) => ({
    initializeAuth: state.initializeAuth,
    loadFromDB: state.loadFromDB,
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
              console.log('No activities found in database, fetching from Strava API');
              // Automatically fetch activities from Strava when none are found in the database
              loadFromStrava({ photos: true })
                .then((count: number) => {
                  console.log(`Successfully fetched ${count} activities from Strava`);
                  addNotification({
                    type: 'success',
                    title: 'Activities loaded',
                    message: `Successfully loaded ${count} activities from Strava`,
                  });
                })
                .catch((error: Error) => {
                  console.error('Error fetching activities from Strava:', error);
                  addNotification({
                    type: 'error',
                    title: 'Error loading activities',
                    message: 'Failed to fetch activities from Strava. Please try again later.',
                  });
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
    loadFromStrava,
    addNotification,
    user,
    account,
  ]);

  return <>{children}</>;
}
