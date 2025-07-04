'use client';

import React, { useContext, useMemo } from 'react';
import { Settings } from 'lucide-react';
import { useStore, useShallowStore } from '~/store';
import { Separator } from '~/components/ui/separator';
import { useShallow } from 'zustand/shallow';
import statsPlots from '~/components/stats';
import { StatsContext, StatsProvider } from '~/app/stats/[name]/StatsContext';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { TabsTrigger, TabsList, Tabs } from '~/components/ui/tabs';
import { StatsPlots } from '~/store/stats';
import Plot from '~/components/stats/plot';

type StatsPlotsKeys = keyof typeof statsPlots;

const tabs = (Object.keys(statsPlots) as (keyof typeof statsPlots)[]).reduce(
  (acc, name, index) => ({
    ...acc,
    [name]: { label: name, index },
  }),
  {} as Record<StatsPlotsKeys, { label: string; index: number }>,
);

export default function StatsPage() {
  const { settingsOpen, setSettingsOpen, activeTab, setActiveTab } = useStore(
    useShallow((state) => ({
      settingsOpen: state.settingsOpen,
      setSettingsOpen: state.setSettingsOpen,
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
    })),
  );

  // Default to calendar if no active tab
  const currentTab = useMemo(() => {
    if (activeTab.startsWith('/stats/')) {
      const tabName = activeTab.replace('/stats/', '') as StatsPlotsKeys;
      return Object.keys(statsPlots).includes(tabName) ? tabName : 'calendar';
    }
    return 'calendar';
  }, [activeTab]);

  const handleTabChange = (tabName: StatsPlotsKeys) => {
    setActiveTab(`/stats/${tabName}` as StatsPlots);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col flex-nowrap overflow-hidden">
      <StatsProvider>
        <StatsContent 
          currentTab={currentTab}
          onTabChange={handleTabChange}
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
        />
      </StatsProvider>
    </div>
  );
}

const StatsContent = React.memo(function StatsContent({
  currentTab,
  onTabChange,
  settingsOpen,
  setSettingsOpen,
}: {
  currentTab: StatsPlotsKeys;
  onTabChange: (tab: StatsPlotsKeys) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const { settingsRef, elementRef } = useContext(StatsContext);

  return (
    <>
      <div className="flex w-full shrink-0 items-stretch overflow-hidden">
        <Tabs value={currentTab} onValueChange={onTabChange} className="flex-1">
          <TabsList className="inline-flex h-9 w-full items-center justify-start rounded-none border-b bg-transparent p-0 text-muted-foreground">
            {Object.entries(tabs).map(([tabName, tab]) => (
              <TabsTrigger
                key={tabName}
                value={tabName}
                className="relative inline-flex h-9 items-center justify-center whitespace-nowrap rounded-none border-b-2 border-b-transparent bg-transparent px-4 py-1 pb-2 pt-2 text-sm font-semibold text-muted-foreground shadow-none ring-offset-background transition-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-b-primary data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <span className="capitalize">{tab.label}</span>
              </TabsTrigger>
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
        <Plot name={currentTab} />
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
    </>
  );
});