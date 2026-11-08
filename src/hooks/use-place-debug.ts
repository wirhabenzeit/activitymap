'use client';

import { useQuery } from '@tanstack/react-query';

import { placeDebugCapabilitySchema } from '~/contracts/place-debug';
import { useShallowStore } from '~/store';
import { usePlaceDebug } from '~/store/place-debug';

export function usePlaceDebugAccess(check = true) {
  const { userId, authSession } = useShallowStore((state) => ({
    userId:
      state.isInitialized && !state.isGuest && state.user?.stravaConnected
        ? state.user.id
        : undefined,
    authSession: state.authSession,
  }));
  const enabledFor = usePlaceDebug((state) => state.userId);
  const query = useQuery({
    queryKey: ['place-debug-access', userId, authSession],
    enabled: Boolean(userId) && (check || enabledFor === userId),
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/debug/places', {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Access check failed');
      const data = placeDebugCapabilitySchema.parse(await response.json());
      if (data.userId !== userId) throw new Error('Account changed');
      return data;
    },
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
  });
  const allowed = Boolean(
    userId &&
    query.data?.userId === userId &&
    query.data.allowed &&
    !query.isError,
  );
  return {
    userId,
    authSession,
    allowed,
    active: allowed && enabledFor === userId,
  };
}
