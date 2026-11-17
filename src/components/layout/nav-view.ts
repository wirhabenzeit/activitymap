import { isStatsRoute } from '~/lib/stats/route';

export type NavigationView = 'map' | 'list' | 'stats';

/** The top-level view a path belongs to; other routes belong to none, so no
 * navigation item claims to be the current page there. */
export function navigationView(
  pathname: string | null | undefined,
): NavigationView | undefined {
  if (pathname === '/' || pathname === '/map' || pathname?.startsWith('/map/'))
    return 'map';
  if (pathname === '/list' || pathname?.startsWith('/list/')) return 'list';
  if (isStatsRoute(pathname)) return 'stats';
  return undefined;
}

/** The paths of the views the app shell renders itself (see `AppViews`). */
export const appViewPaths = {
  map: '/map',
  list: '/list',
  stats: '/stats/tiles',
} as const satisfies Record<NavigationView, string>;

/** The shell view at exactly this path; `/stats/review` and friends are
 * ordinary pages that Next.js renders. */
export function appViewForPath(
  pathname: string | null | undefined,
): NavigationView | undefined {
  return (Object.keys(appViewPaths) as NavigationView[]).find(
    (view) => appViewPaths[view] === pathname,
  );
}
