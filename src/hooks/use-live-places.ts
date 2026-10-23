'use client';

import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import {
  DEFAULT_LIVE_RADII,
  LIVE_PLACE_LIMIT,
  type LivePlaceRequest,
  livePlaceResponseSchema,
} from '~/contracts/live-places';
import { useShallowStore } from '~/store';

import { useLibrarySnapshot } from './use-library-snapshot';

type LiveSettings = {
  active: boolean;
  thresholds: LivePlaceRequest['thresholds'];
  setActive: (value: boolean) => void;
  setThresholds: (value: LivePlaceRequest['thresholds']) => void;
};
// Temporary review controls; never persisted or shared through map URLs.
export const useLivePlacesSettings = create<LiveSettings>((set) => ({
  active: false,
  thresholds: DEFAULT_LIVE_RADII,
  setActive: (active) => set({ active }),
  setThresholds: (thresholds) => set({ thresholds }),
}));

export function useLivePlaces() {
  const { active, thresholds } = useLivePlacesSettings();
  const { selected, userId } = useShallowStore((state) => ({
    selected: state.selected,
    userId:
      state.isInitialized && !state.isGuest && state.user?.stravaConnected
        ? state.user.id
        : undefined,
  }));
  const library = useLibrarySnapshot();
  const available = process.env.NODE_ENV === 'development' && !!userId;
  const enabled =
    available &&
    active &&
    selected.length > 0 &&
    selected.length <= LIVE_PLACE_LIMIT;
  const activityIds = selected.map(String).sort();
  const query = useQuery({
    queryKey: [
      'library',
      library.scope,
      'live-places',
      library.snapshot?.revision,
      activityIds,
      thresholds,
    ],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/experimental/live-places', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityIds, thresholds }),
      });
      if (!response.ok) throw new Error('Live matching unavailable');
      const result = livePlaceResponseSchema.parse(await response.json());
      if (result.userId !== userId) throw new Error('Account changed');
      return result;
    },
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  return {
    ...query,
    available,
    active: available && active,
    enabled,
    selectedCount: selected.length,
    data:
      enabled && !query.isError && !query.isFetching ? query.data : undefined,
  };
}
