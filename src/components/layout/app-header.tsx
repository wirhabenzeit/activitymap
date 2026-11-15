'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Separator } from '~/components/ui/separator';
import { SidebarTrigger, useSidebar } from '~/components/ui/sidebar';
import { store } from '~/store';
import { useHeaderSearch } from '~/store/header-search';

import { HeaderSearchBar, HeaderSearchButton } from './header-search';
import { MainNav } from './main-nav';

export const AppHeader = () => {
  const pathname = usePathname();
  const { active, begin, end } = useHeaderSearch();
  const { isMobile, setOpenMobile } = useSidebar();
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
        <SidebarTrigger />
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
