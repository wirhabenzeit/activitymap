'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Separator } from '~/components/ui/separator';
import { SidebarTrigger } from '~/components/ui/sidebar';
import { store } from '~/store';

import { ShareButton } from '../share-button';
import { MainNav } from './main-nav';

export const AppHeader = () => {
  const pathname = usePathname();
  React.useEffect(() => {
    if (pathname?.startsWith('/stats'))
      store.getState().setCombineSelections(false);
  }, [pathname]);
  return (
    <header className="fixed inset-x-0 top-0 z-[60] border-border/40 bg-header-background px-2 text-header-foreground">
      <div className="flex h-14 items-center">
        <SidebarTrigger />
        <Separator
          orientation="vertical"
          color="white"
          className="mx-2 h-8 bg-header-foreground"
        />
        <MainNav />
        <div className="flex flex-1 items-center justify-end space-x-2">
          <nav className="flex items-center text-header-foreground">
            <ShareButton />
          </nav>
        </div>
      </div>
    </header>
  );
};
