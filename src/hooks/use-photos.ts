'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dtoToPhoto } from '~/lib/sync/v1-mappers';
import { libraryQueryState } from '~/lib/sync/library-query-state';
import { useLibrarySnapshot } from './use-library-snapshot';

export function usePhotos() {
  const library = useLibrarySnapshot();
  // Public/guest content supplies its own data. Preserve the existing disabled
  // unauthenticated gallery observer without touching authenticated storage.
  const guest = useQuery({
    queryKey: ['photos', null],
    queryFn: () => Promise.resolve([]),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const photoDTOs = library.snapshot?.photos;
  const loaded = library.snapshot?.loaded;
  const data = useMemo(
    () => (loaded && photoDTOs ? photoDTOs.map(dtoToPhoto) : undefined),
    [loaded, photoDTOs],
  );
  const state = useMemo(
    () => libraryQueryState(library.snapshot, library.sync, data?.length ?? 0),
    [library.snapshot, library.sync, data?.length],
  );
  if (!library.scope) return guest;
  return { ...state, data, refetch: library.refetch };
}
