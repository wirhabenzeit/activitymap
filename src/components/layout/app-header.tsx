'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Separator } from '~/components/ui/separator';
import { SidebarTrigger, useSidebar } from '~/components/ui/sidebar';
import { message } from '~/lib/presentation/messages';
import { store, useShallowStore } from '~/store';
import { activeFilterCount } from '~/store/filter';
import { useHeaderSearch } from '~/store/header-search';

import { HeaderSearchBar, HeaderSearchButton } from './header-search';
import { MainNav } from './main-nav';

export const AppHeader = () => {
  const pathname = usePathname();
  const { active, begin, end } = useHeaderSearch();
  const { isMobile, setOpenMobile } = useSidebar();
  const filterCount = useShallowStore((state) =>
    activeFilterCount(
      state,
      pathname?.startsWith('/stats') ? 'stats' : 'browse',
    ),
  );
  React.useEffect(() => {
    if (pathname?.startsWith('/stats'))
      store.getState().setCombineSelections(false);
  }, [pathname]);
  // Search is transient: leaving the view ends it.
  React.useEffect(() => end, [pathname, end]);
  const beginSearch = React.useCallback(() => {
    // On a phone, search takes over from the Filters sheet.
    if (isMobile) setOpenMobile(false);
    begin();
  }, [isMobile, setOpenMobile, begin]);
  return (
    <header className="fixed inset-x-0 top-0 z-[60] border-border/40 bg-header-background px-2 text-header-foreground">
      <div className="flex h-14 items-center">
        <span className="relative">
          <SidebarTrigger
            aria-label={
              filterCount
                ? message('navigation.activeFilters', { count: filterCount })
                : message('navigation.filters')
            }
          />
          {filterCount > 0 && (
            <span
              aria-hidden
              data-testid="filter-count-badge"
              className="pointer-events-none absolute top-1.5 right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-white px-1 text-[11px] leading-none font-bold text-header-background tabular-nums"
            >
              {filterCount}
            </span>
          )}
        </span>
        <Separator
          orientation="vertical"
          color="white"
          className="mx-2 h-8 bg-header-foreground"
        />
        {active ? (
          <HeaderSearchBar />
        ) : (
          <>
            <MainNav />
            <div className="flex flex-1 items-center justify-end">
              <HeaderSearchButton onBegin={beginSearch} />
            </div>
          </>
        )}
      </div>
    </header>
  );
};
