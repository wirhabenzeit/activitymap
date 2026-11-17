'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isPlainClick, switchViewInPage } from '~/lib/app-views';
import { message } from '~/lib/presentation/messages';
import { cn } from '~/lib/utils';

import { type NavigationView, navigationView } from './nav-view';

const items: { view: NavigationView; href: string; label: () => string }[] = [
  { view: 'map', href: '/map', label: () => message('navigation.map') },
  { view: 'list', href: '/list', label: () => message('navigation.list') },
  {
    view: 'stats',
    href: '/stats/tiles',
    label: () => message('navigation.stats'),
  },
];

export function MainNav() {
  const currentView = navigationView(usePathname());

  return (
    <div className="mr-4 ml-2 flex">
      <Link
        href="/"
        aria-label={message('navigation.home')}
        className="mr-4 flex min-h-11 items-center space-x-2 text-header-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 lg:mr-6"
      >
        <Image
          src="/app-mark.svg"
          alt=""
          width={27}
          height={24}
          className="h-6 w-auto"
        />
        <span className="hidden font-bold lg:inline-block">ActivityMap</span>
      </Link>
      <nav
        aria-label={message('navigation.view')}
        className="flex items-center gap-4 text-sm font-semibold lg:gap-6"
      >
        {items.map(({ view, href, label }) => (
          <Link
            key={view}
            href={href}
            onClick={(event) => {
              // Between shell views, skip the server round-trip of a route
              // navigation; see `~/lib/app-views.ts`.
              if (isPlainClick(event) && switchViewInPage(href))
                event.preventDefault();
            }}
            aria-current={currentView === view ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center hover:text-header-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4',
              currentView === view
                ? 'text-header-foreground'
                : 'text-header-foreground/60',
            )}
          >
            {label()}
          </Link>
        ))}
      </nav>
    </div>
  );
}
