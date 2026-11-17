import { navigationView } from '~/components/layout/nav-view';

export type Workspace = 'activities' | 'stats' | 'places';

export function workspaceFor(
  pathname: string | null | undefined,
): Workspace | undefined {
  if (pathname === '/places' || pathname?.startsWith('/places/'))
    return 'places';
  if (pathname === '/stats-focus-preview') return 'stats';
  const view = navigationView(pathname);
  return view === 'map' || view === 'list' ? 'activities' : view;
}
