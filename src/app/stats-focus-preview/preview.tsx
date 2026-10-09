'use client';

import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatsTileGrid } from '~/components/stats/tiles';
import { FilterScope } from '~/components/stats/tiles/scope';
import { StatsActivityInspector } from '~/components/stats/tiles/activity-inspector';
import { AppSidebar } from '~/components/layout/app-sidebar';
import { SidebarProvider, SidebarTrigger } from '~/components/ui/sidebar';
import { Separator } from '~/components/ui/separator';
import Image from 'next/image';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { toStatsActivity } from '~/lib/stats/tile-series';
import { dayFromISODate } from '~/lib/stats/tile-data';
import {
  filterStatsActivities,
  statsFilterScope,
} from '~/lib/stats/filter-scope';
import { useShallowStore } from '~/store';
import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';

const defaults = Object.fromEntries(
  Object.keys(activityDTOSchema.shape)
    .filter((key) => key !== 'streams')
    .map((key) => [key, null]),
);

function PreviewStats() {
  const activities = useMemo(
    () =>
      fixture.activities.map((item) =>
        dtoToActivity(activityDTOSchema.parse({ ...defaults, ...item })),
      ),
    [],
  );
  const filters = useShallowStore((state) => ({
    sportType: state.sportType,
    sportGroup: state.sportGroup,
    dateRange: state.dateRange,
    values: state.values,
    binary: state.binary,
    search: state.search,
  }));
  const reset = useShallowStore((state) => state.resetActivityFilters);
  const stats = useMemo(
    () => filterStatsActivities(activities, filters).map(toStatsActivity),
    [activities, filters],
  );
  const scope = statsFilterScope(filters);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterScope labels={scope.labels} onReset={reset} />
      <div className="min-h-0 flex-1">
        <StatsActivityInspector activities={activities} preview>
          {(open, detailsOpen, inspection) => (
            <StatsTileGrid
              activities={stats}
              filtered={scope.filtered}
              singleSport={scope.singleSport}
              reportingDay={dayFromISODate('2026-09-22')}
              onOpenActivity={open}
              detailsOpen={detailsOpen}
              {...inspection}
            />
          )}
        </StatsActivityInspector>
      </div>
    </div>
  );
}

export default function StatsFocusPreview() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <SidebarProvider className="flex h-dvh flex-col">
        <header className="fixed inset-x-0 top-0 z-[60] bg-header-background px-2 text-header-foreground">
          <div className="flex h-14 items-center">
            <SidebarTrigger className="h-8 w-8" />
            <Separator
              orientation="vertical"
              className="mx-2 h-8 bg-header-foreground"
            />
            <a
              href="/stats-focus-preview"
              aria-label="ActivityMap stats preview"
              className="ml-2 mr-4 flex items-center gap-2 lg:mr-6"
            >
              <Image
                src="/app-mark.svg"
                alt=""
                width={27}
                height={24}
                className="h-6 w-auto"
              />
              <span className="hidden font-bold lg:inline-block">
                ActivityMap
              </span>
            </a>
            <nav className="flex items-center gap-4 text-sm font-semibold lg:gap-6">
              <button
                disabled
                title="List is unavailable in this sample stats preview"
                className="cursor-not-allowed text-header-foreground/40"
              >
                List
              </button>
              <a href="/stats-focus-preview">Stats</a>
            </nav>
            <span className="ml-auto px-2 text-xs text-header-foreground/80">
              Sample preview
            </span>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="h-14 w-full shrink-0" />
            <div className="min-h-0 w-full flex-1 overflow-hidden">
              <PreviewStats />
            </div>
            <p className="shrink-0 border-t px-4 py-1 text-xs text-muted-foreground">
              Local preview · sample activities · September 22, 2026
            </p>
          </main>
        </div>
      </SidebarProvider>
    </QueryClientProvider>
  );
}
