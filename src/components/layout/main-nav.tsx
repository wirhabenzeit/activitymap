'use client';

import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { cn } from '~/lib/utils';

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();

  const handleNavigation = (path: string) => {
    router.push(path);
  };

  // Get current view from pathname for highlighting
  const getCurrentView = () => {
    if (pathname === '/list') return 'list';
    if (pathname?.startsWith('/stats')) return 'stats';
    return 'map'; // default to map for root path
  };

  const currentView = getCurrentView();

  return (
    <div className="ml-2 mr-4 flex">
      <button
        aria-label="ActivityMap home"
        onClick={() => handleNavigation('/')}
        className={cn(
          'hover:text-header-foreground mr-4 flex items-center space-x-2 lg:mr-6',
          currentView === 'map'
            ? 'text-header-foreground'
            : 'text-header-foreground/60',
        )}
      >
        <Image
          src="/favicon.svg"
          alt=""
          width={24}
          height={24}
          className="h-6 w-6"
        />
        <span className="hidden font-bold lg:inline-block">ActivityMap</span>
      </button>
      <nav className="flex items-center gap-4 text-sm font-semibold lg:gap-6">
        <button
          onClick={() => handleNavigation('/list')}
          className={cn(
            'hover:text-header-foreground',
            currentView === 'list'
              ? 'text-header-foreground'
              : 'text-header-foreground/60',
          )}
        >
          List
        </button>
        <button
          onClick={() => handleNavigation('/stats/tiles')}
          className={cn(
            'hover:text-header-foreground',
            currentView === 'stats'
              ? 'text-header-foreground'
              : 'text-header-foreground/60',
          )}
        >
          Stats
        </button>
      </nav>
    </div>
  );
}
