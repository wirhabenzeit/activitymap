'use client';

import { useMemo } from 'react';

import { useActivities } from '~/hooks/use-activities';
import { buildPlaceLibrary } from '~/lib/place-library';
import { hasStoredLibraryAccess } from '~/lib/stored-library-access';
import { useShallowStore } from '~/store';

export function usePlaceLibrary() {
  const query = useActivities();
  const userId = useShallowStore((state) =>
    !state.isGuest && hasStoredLibraryAccess(state.user)
      ? state.user?.id
      : undefined,
  );
  const library = useMemo(
    () =>
      buildPlaceLibrary(
        query.data ?? [],
        userId,
        query.data !== undefined && !query.hasNextPage,
      ),
    [query.data, query.hasNextPage, userId],
  );
  return { library, activities: query.data };
}
