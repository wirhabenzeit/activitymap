'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';

import { cn } from '~/lib/utils';

const InteractiveMap = dynamic(
  () => import('~/components/map/interactive-map'),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted/20" />,
  },
);

/**
 * The `/map` view, kept mounted by `AppViews` across Map/List/Stats switches.
 * Remounting it rebuilt the MapLibre route source from every activity, which
 * blocked the main thread for ~400 ms and took ~1 s to redraw with a few
 * thousand activities.
 *
 * It cannot use React `<Activity>` like the other views: hiding runs effect
 * cleanups, which remove the map's sources and layers. Instead it is made
 * invisible, kept out of the tab order with `inert`, and frozen through
 * `InteractiveMap`'s `active` prop. The container keeps its size while
 * hidden, so showing it again needs no canvas resize.
 */
export function PersistentMap({ active }: { active: boolean }) {
  return (
    <div
      // `invisible` alone is not enough: MapLibre's compact attribution sets
      // `visibility: visible` on itself; opacity cannot be overridden below.
      className={cn('absolute inset-0', !active && 'invisible opacity-0')}
      aria-hidden={!active}
      inert={!active}
      data-map-view={active ? 'active' : 'hidden'}
    >
      <Suspense>
        <InteractiveMap active={active} />
      </Suspense>
    </div>
  );
}
