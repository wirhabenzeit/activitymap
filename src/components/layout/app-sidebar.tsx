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
          <SidebarGroupLabel>{message('navigation.filters')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SearchFilter />
              <SelectedActivitiesFilter />
              <MonthPicker />
              <InequalityFilter name="distance" />
              <InequalityFilter name="total_elevation_gain" />
              <InequalityFilter name="elapsed_time" />
              <BinaryFilter name="commute" />
              <BinaryFilter name="private" />
              <BinaryFilter name="flagged" />
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
