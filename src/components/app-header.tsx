'use client';

import { MainNav } from './main-nav';
import { SidebarTrigger } from './ui/sidebar';
import { Separator } from './ui/separator';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '~/components/ui/button';
import { ShareButton } from './Share';

export function ModeToggle() {
  const { setTheme, theme } = useTheme();
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme}>
      <Sun className="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}

export const AppHeader = () => {
  return (
    <header className="fixed inset-x-0 top-0 z-30 border-border/40 bg-header-background px-2 text-header-foreground">
      <div className="flex h-14 items-center">
        <SidebarTrigger className="h-8 w-8" />
        <Separator
          orientation="vertical"
          color="white"
          className="mx-2 h-8 bg-header-foreground"
        />
        <MainNav />
        <div className="flex flex-1 items-center justify-end space-x-2">
          <nav className="flex items-center text-header-foreground">
            <ShareButton />
            <ModeToggle />
          </nav>
        </div>
      </div>
    </header>
  );
};
