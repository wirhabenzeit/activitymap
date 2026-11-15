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
