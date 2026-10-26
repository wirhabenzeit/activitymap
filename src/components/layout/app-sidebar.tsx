'use client';

import * as React from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from '~/components/ui/sidebar';
import { message } from '~/lib/presentation/messages';

import {
  BinaryFilter,
  CategoryFilter,
  InequalityFilter,
  MonthPicker,
  ResetFilters,
  SearchFilter,
  SelectedActivitiesFilter,
} from './sidebar/filters';
import { UserSettings } from './sidebar/user';

export function AppSidebar() {
  const { isMobile } = useSidebar();

  return (
    <Sidebar id="activity-filters" collapsible="icon">
      {!isMobile && (
        <SidebarHeader>
          <div className="h-10" />
        </SidebarHeader>
      )}
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <SidebarGroupLabel>
            {message('navigation.categories')}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <CategoryFilter />
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
        <SidebarGroup>
          <SidebarGroupLabel>
            {message('filters.group.totals')}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <InequalityFilter name="distance" />
              <InequalityFilter name="total_elevation_gain" />
              <InequalityFilter name="elapsed_time" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>
            {message('filters.group.flags')}
          </SidebarGroupLabel>
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
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <UserSettings />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
