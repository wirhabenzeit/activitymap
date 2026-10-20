'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { message } from '~/lib/presentation/messages';
import { cn } from '~/lib/utils';

export function MainNav() {
  const pathname = usePathname();

  // Get current view from pathname for highlighting
  const getCurrentView = () => {
    if (pathname === '/list') return 'list';
    if (pathname?.startsWith('/stats')) return 'stats';
    return 'map'; // default to map for root path
  };

  const currentView = getCurrentView();

  return (
    <div className="mr-4 ml-2 flex">
      <Link
        href="/"
        aria-current={currentView === 'map' ? 'page' : undefined}
        aria-label={message('navigation.home')}
        className={cn(
          'mr-4 flex min-h-11 items-center space-x-2 hover:text-header-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 lg:mr-6',
          currentView === 'map'
            ? 'text-header-foreground'
            : 'text-header-foreground/60',
        )}
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
        <Link
          href="/list"
          aria-current={currentView === 'list' ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center hover:text-header-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4',
            currentView === 'list'
              ? 'text-header-foreground'
              : 'text-header-foreground/60',
          )}
        >
          {message('navigation.list')}
        </Link>
        <Link
          href="/stats/tiles"
          aria-current={currentView === 'stats' ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center hover:text-header-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4',
            currentView === 'stats'
              ? 'text-header-foreground'
              : 'text-header-foreground/60',
          )}
        >
          {message('navigation.stats')}
        </Link>
      </nav>
    </div>
  );
}
