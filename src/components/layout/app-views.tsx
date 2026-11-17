'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Activity, Suspense, useEffect, useState } from 'react';

import {
  type NavigationView,
  appViewForPath,
} from '~/components/layout/nav-view';
import { PersistentMap } from '~/components/map/persistent-map';

const loadList = () => import('~/components/list/library-list');
const loadStats = () => import('~/components/stats/tiles');
const LibraryList = dynamic(loadList);
const StatsTiles = dynamic(loadStats);

/**
 * Map, List and Stats, owned by the app shell instead of their route pages
 * (which render nothing). Each view mounts on its first visit and then stays:
 * - the map is only hidden (see `PersistentMap`), because tearing it down
 *   rebuilt the route source from every activity on each return;
 * - List and Stats sit in React `<Activity>`, which hides them, pauses their
 *   effects and keeps their state (scroll position, open details), so
 *   returning does not re-render a few thousand rows.
 * Together with `navigateToView` this makes a tab switch a local re-render
 * with no server request.
 */
export function AppViews() {
  const view = appViewForPath(usePathname());
  const [visited, setVisited] = useState<ReadonlySet<NavigationView>>(
    () => new Set(view ? [view] : []),
  );
  if (view && !visited.has(view)) setVisited(new Set([...visited, view]));

  // Fetch the other views' code once the first one has settled, so the first
  // switch to them does not wait on a chunk download.
  useEffect(() => {
    const preload = () => {
      void loadList();
      void loadStats();
      void import('~/components/map/interactive-map');
    };
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(preload, { timeout: 5000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = setTimeout(preload, 2000);
    return () => clearTimeout(handle);
  }, []);

  return (
    <>
      {visited.has('map') && <PersistentMap active={view === 'map'} />}
      {visited.has('list') && (
        <Activity mode={view === 'list' ? 'visible' : 'hidden'}>
          <Suspense>
            <LibraryList />
          </Suspense>
        </Activity>
      )}
      {visited.has('stats') && (
        <Activity mode={view === 'stats' ? 'visible' : 'hidden'}>
          <div
            className="h-full min-h-0 w-full"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <StatsTiles />
          </div>
        </Activity>
      )}
    </>
  );
}
