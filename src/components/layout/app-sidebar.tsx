'use client';

import * as React from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarHeader,
  useSidebar,
  SidebarFooter,
} from '~/components/ui/sidebar';

import {
  InequalityFilter,
  MonthPicker,
  CategoryFilter,
  BinaryFilter,
  ResetFilters,
  SearchFilter,
} from './sidebar/filters';

import { UserSettings } from './sidebar/user';

export function AppSidebar() {
  const { isMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      {!isMobile && (
        <SidebarHeader>
          <div className="h-10" />
        </SidebarHeader>
      )}
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <SidebarGroupLabel>Categories</SidebarGroupLabel>
          <SidebarGroupContent>
            <CategoryFilter />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Filters</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SearchFilter />
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
