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
      <SidebarContent>
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
              <MonthPicker />
              <InequalityFilter name="distance" />
              <InequalityFilter name="total_elevation_gain" />
              <InequalityFilter name="elapsed_time" />
              {/* <BinaryFilter name="commute" /> */}
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
