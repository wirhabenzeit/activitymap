'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Separator } from '~/components/ui/separator';
import { SidebarTrigger } from '~/components/ui/sidebar';
import { useActiveFilterCount } from '~/hooks/use-active-filter-count';
import { isStatsRoute } from '~/lib/stats/route';
import { store } from '~/store';

import { AccountButton, SettingsDialogHost } from './account-entry';
import { MainNav } from './main-nav';

export const AppHeader = () => {
  const pathname = usePathname();
  const activeFilters = useActiveFilterCount();
  React.useEffect(() => {
    if (isStatsRoute(pathname)) store.getState().setCombineSelections(false);
  }, [pathname]);
  return (
    <header className="fixed inset-x-0 top-0 z-[60] border-border/40 bg-header-background px-2 text-header-foreground">
      <div className="flex h-14 items-center">
        <SidebarTrigger activeCount={activeFilters} />
        <Separator
          orientation="vertical"
          color="white"
          className="mx-2 h-8 bg-header-foreground"
        />
        <MainNav />
        <div className="ml-auto flex items-center">
          <AccountButton />
        </div>
        <SettingsDialogHost />
      </div>
    </header>
  );
};
