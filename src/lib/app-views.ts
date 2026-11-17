'use client';

import type { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { appViewForPath } from '~/components/layout/nav-view';

/*
 * Navigation between the app shell's three top-level views (`appViewPaths`).
 * The shell (`AppViews`) renders them itself from the pathname; their route
 * pages render nothing. Switching between them therefore needs no server
 * round-trip: while one of these pages is the route Next.js has rendered, the
 * URL is changed with the native History API, which Next.js folds into its
 * router (`usePathname` follows).
 */

// How many view route pages are mounted (0 or 1 outside Strict Mode replays).
let viewPagesMounted = 0;

/** Rendered by each view route's page so the shell knows it owns the screen. */
export function useAppViewPage() {
  useEffect(() => {
    viewPagesMounted++;
    return () => {
      viewPagesMounted--;
    };
  }, []);
}

type Router = Pick<ReturnType<typeof useRouter>, 'push'>;

/**
 * Go to `href`. Between shell views this only pushes a history entry; from
 * any other page (whose content Next.js must replace) it is a router push.
 */
export function navigateToView(router: Router, href: string) {
  if (!switchViewInPage(href)) router.push(href);
}

/** Switch views with a history entry if both ends are shell views. */
export function switchViewInPage(href: string): boolean {
  const url = new URL(href, window.location.href);
  if (!viewPagesMounted || !appViewForPath(url.pathname)) return false;
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.pushState(null, '', next);
  return true;
}

/** A plain left click a link may handle in-page (not new tab/window). */
export function isPlainClick(event: React.MouseEvent) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
