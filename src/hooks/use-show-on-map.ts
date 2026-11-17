'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';

import type { Activity } from '~/lib/activity';
import { navigateToView } from '~/lib/app-views';
import { showActivityOnMap } from '~/lib/show-on-map';
import { store } from '~/store';

export type MapActionVariant = 'show' | 'clear-filters-and-show';
export type ActivityMapCommand = (
  activity: Activity,
  variant: MapActionVariant,
) => void;

/** A screen owns library access. Rows receive this command, never observers. */
export function useShowOnMap(activities: Activity[] | undefined) {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (activity: Activity, variant: MapActionVariant) => {
      const result = showActivityOnMap(
        store,
        activity,
        activities ?? [activity],
        variant === 'clear-filters-and-show',
      );
      if (result !== 'shown') {
        store.getState().addNotification({
          type: 'info',
          title: 'Map camera',
          message:
            result === 'no-route'
              ? 'This activity has no GPS route to frame.'
              : result === 'unavailable'
                ? 'This activity is no longer available.'
                : 'This activity is hidden by filters. Clear filters and try again.',
        });
        return;
      }
      if (pathname === '/selection-prototype')
        router.push('/selection-prototype?view=map');
      else navigateToView(router, '/map');
    },
    [activities, pathname, router],
  );
}
