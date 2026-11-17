'use client';

import { usePathname } from 'next/navigation';
import { useCallback } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from '~/components/ui/sidebar';
import { message } from '~/lib/presentation/messages';
import { workspaceFor } from '~/lib/workspace';
import { useShallowStore } from '~/store';

import {
  BinaryFilter,
  CategoryFilter,
  FilterSummary,
  InequalityFilter,
  MonthPicker,
  ResetFilters,
  SearchFilter,
  SelectedActivitiesFilter,
} from './sidebar/filters';

export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const workspace = workspaceFor(pathname);

  return (
    <Sidebar id="activity-filters" collapsible="icon">
      {!isMobile && (
        <SidebarHeader>
          <div className="h-10" />
        </SidebarHeader>
      )}
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <FilterSummary />
          </SidebarGroupContent>
        </SidebarGroup>
        {workspace === 'stats' ? <StatsScopePanel /> : <ActivityFilterPanel />}
      </SidebarContent>
    </Sidebar>
  );
}

function AdvancedFilters() {
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>{message('filters.group.totals')}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <InequalityFilter name="distance" />
            <InequalityFilter name="total_elevation_gain" />
            <InequalityFilter name="elapsed_time" />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>{message('filters.group.flags')}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <BinaryFilter name="commute" />
            <BinaryFilter name="private" />
            <BinaryFilter name="flagged" />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SelectedActivitiesFilter />
            <ResetFilters />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

export function ActivityFilterPanel() {
  const { sportType, sportGroup, setSportType, setSportGroup } =
    useShallowStore((s) => ({
      sportType: s.sportType,
      sportGroup: s.sportGroup,
      setSportType: s.setSportType,
      setSportGroup: s.setSportGroup,
    }));
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>
          {message('navigation.categories')}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <CategoryFilter
            value={sportGroup}
            onChange={setSportGroup}
            sportType={sportType}
            onSportTypeChange={setSportType}
          />
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SearchFilter />
            <MonthPicker />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <AdvancedFilters />
    </>
  );
}

export function StatsScopePanel() {
  const { sports, setSports } = useShallowStore((s) => ({
    sports: s.statsSports,
    setSports: s.setStatsSports,
  }));
  const onChange = useCallback<
    Parameters<typeof CategoryFilter>[0]['onChange']
  >(
    (update) =>
      setSports((previous) => {
        const next = typeof update === 'function' ? update(previous) : update;
        return Object.fromEntries(
          Object.entries(next).map(([key, value]) => [key, value === true]),
        ) as typeof previous;
      }),
    [setSports],
  );
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Sports</SidebarGroupLabel>
        <SidebarGroupContent>
          <CategoryFilter value={sports} groupsOnly onChange={onChange} />
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <ResetFilters />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
