'use client';

import React, { useContext } from 'react';

import { Settings } from 'lucide-react';

import { useStore } from '~/store';

import { Separator } from '~/components/ui/separator';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useShallow } from 'zustand/shallow';

import statsPlots from '~/components/stats';
import { StatsContext, StatsProvider } from './StatsContext';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { TabsTrigger, TabsList, Tabs } from '~/components/ui/tabs';
import { StatsPlots } from '~/store/stats';

type StatsPlotsKeys = keyof typeof statsPlots;
type TabKeys = `/stats/${StatsPlotsKeys}`;
type TabValue = { label: string; index: number };

const tabs = (Object.keys(statsPlots) as (keyof typeof statsPlots)[]).reduce(
  (acc, name, index) => ({
    ...acc,
    [`/stats/${name}`]: { label: name, index },
  }),
  {} as Record<TabKeys, TabValue>,
);

const TabsLinkTrigger: React.FC<{
  href: string;
  children: React.ReactNode;
  className?: string;
}> = ({ href, children, className }) => (
  <TabsTrigger value={href} asChild className={className ?? ''}>
    <Link href={href}>{children}</Link>
  </TabsTrigger>
);

export default function Stats({ children }: { children: React.ReactNode }) {
  const { settingsOpen, setSettingsOpen, activeTab, setActiveTab } = useStore(
    useShallow((state) => ({
      settingsOpen: state.settingsOpen,
      setSettingsOpen: state.setSettingsOpen,
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
    })),
  );

  const pathname = usePathname();
  if (Object.values(StatsPlots).includes(pathname as StatsPlots)) {
    setActiveTab(pathname as StatsPlots);
  }

  const { settingsRef, elementRef } = useContext(StatsContext);

  return (
    <div className="flex h-full min-h-0 w-full flex-col flex-nowrap overflow-hidden">
      <StatsProvider>
        <div className="flex w-full shrink-0 items-stretch overflow-hidden">
          <Tabs defaultValue={pathname} className="flex-1">
            <TabsList className="inline-flex h-9 w-full items-center justify-start rounded-none border-b bg-transparent p-0 text-muted-foreground">
              {Object.entries(tabs).map(([url, tab]) => (
                <TabsLinkTrigger
                  href={url}
                  key={url}
                  className="relative inline-flex h-9 items-center justify-center whitespace-nowrap rounded-none border-b-2 border-b-transparent bg-transparent px-4 py-1 pb-2 pt-2 text-sm font-semibold text-muted-foreground shadow-none ring-offset-background transition-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-b-primary data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <span className="capitalize">{tab.label}</span>
                </TabsLinkTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="m-l-auto right-0 inline-flex">
            <Separator orientation="vertical" />
            <Button
              variant="link"
              onClick={() => setSettingsOpen((open) => !open)}
              className="rounded-none border-b p-2"
            >
              <Settings
                className={settingsOpen ? 'text-header-background' : ''}
              />
            </Button>
          </div>
        </div>
        <div ref={elementRef} className="min-h-0 w-full grow">
          {children}
        </div>
        <div
          className={cn(
            'w-full overflow-y-hidden overflow-x-scroll border-t-2 border-muted',
            settingsOpen ? 'block' : 'hidden',
          )}
        >
          <div
            className="m-2 flex min-w-max flex-row flex-nowrap items-center justify-evenly space-x-2"
            ref={settingsRef}
          ></div>
        </div>
      </StatsProvider>
    </div>
  );
}
