'use client';

import { useEffect } from 'react';

import { useActivities } from '~/hooks/use-activities';
import { useShallowStore } from '~/store';

export function ActivityStreamer() {
  const isGuest = useShallowStore((state) => state.isGuest);
  const { hasNextPage, fetchNextPage, isFetching } = useActivities();

  useEffect(() => {
    if (isGuest && hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [isGuest, hasNextPage, fetchNextPage, isFetching]);

  return null;
}
