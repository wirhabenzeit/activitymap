'use client';

import { useQuery } from '@tanstack/react-query';

import { visitedPlacesResponseSchema } from '~/contracts/visited-places';
import { useShallowStore } from '~/store';

import { useLibrarySnapshot } from './use-library-snapshot';
import { useLivePlaces } from './use-live-places';

export function useVisitedPlaces() {
  const live = useLivePlaces();
  const library = useLibrarySnapshot();
  const userId = useShallowStore((state) =>
    state.isInitialized && !state.isGuest && state.user?.stravaConnected
      ? state.user.id
      : undefined,
  );
  const enabled =
    process.env.NODE_ENV === 'development' && !!userId && !!library.scope;
  const query = useQuery({
    queryKey: [
      'library',
      library.scope,
      'visited-places',
      library.snapshot?.revision,
    ],
    enabled: enabled && !live.active,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/experimental/visited-places', {
        signal,
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Visited places could not be loaded');
      const result = visitedPlacesResponseSchema.parse(await response.json());
      if (result.userId !== userId)
        throw new Error('Account changed while loading places');
      return result.places;
    },
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
  });
  if (live.active)
    return {
      ...live,
      data: live.data?.places,
      enabled: live.available,
      isPending: live.enabled && live.isFetching,
    };
  return {
    ...query,
    data: enabled && !query.isError ? query.data : undefined,
    enabled,
  };
}
