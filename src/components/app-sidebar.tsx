"use client";

import { Home, ChevronsUpDown, LogOut, CalendarIcon, Bell } from "lucide-react";

import { signIn, signOut } from "next-auth/react";

import { useStore } from "~/contexts/Zustand";
import { useShallow } from "zustand/shallow";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
  SidebarFooter,
} from "~/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { MonthRangePicker } from "./ui/monthrangepicker";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { format } from "date-fns/format";

import * as React from "react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { CategoryFilter } from "./category-filter";
import Image from "next/image";
import { inequalityFilters } from "~/settings/filter";

export function MonthPicker() {
  const [dates, setDates] = useStore(
    useShallow((state) => [state.dateRange, state.setDateRange]),
  );

  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger asChild>
          <SidebarMenuButton className={cn(!dates && "text-muted-foreground")}>
            <CalendarIcon />
            {dates ? (
              `${format(dates.start, "MMM yyyy")} - ${format(dates.end, "MMM yyyy")}`
            ) : (
              <span>Pick a month range</span>
            )}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <MonthRangePicker
            onMonthRangeSelect={setDates}
            selectedMonthRange={dates}
          />
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}

export function InequalityFilter({ name }: { name: string }) {
  const [greater, setGreater] = useState(true);
  const [input, setInput] = useState("");
  const [value, setValue] = useState(0.0);

  const validateInput = (value: string) => {
    const number = parseFloat(value);
    const valid = !isNaN(value);
    if (valid) {
      setInput(value);
      setValue(isNaN(number) ? 0 : number);
    }
  };

  const [setValueFilter, values, filterRanges] = useStore(
    useShallow((state) => [
      state.setValueFilter,
      state.values,
      state.filterRanges,
    ]),
  );

  React.useEffect(() => {
    if (!filterRanges[name]) return;
    const transformed = inequalityFilters[name].transform(value);
    if (greater) setValueFilter(name, [transformed, filterRanges[name][1]]);
    else setValueFilter(name, [filterRanges[name][0], transformed]);
  }, [greater, value]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className="pr-0">
        <div>
          {inequalityFilters[name].icon}
          <span className="relative flex w-full items-center">
            <Button
              className="absolute left-1 h-6 w-6 px-1 py-1 text-foreground/60"
              variant="secondary"
              onClick={() => setGreater((greater) => !greater)}
            >
              {greater ? "≥" : "≤"}
            </Button>
            <Input
              value={input}
              placeholder="0"
              onChange={(event) => validateInput(event.target.value)}
              className="h-8 w-full pl-8 pr-8 text-right focus-visible:bg-background focus-visible:ring-0"
            />
            <span className="absolute right-2 py-1 text-foreground/60">
              {inequalityFilters[name].unit}
            </span>
          </span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function UserSettings() {
  const { user, guest, loading } = useStore(
    useShallow((state) => ({
      user: state.user,
      guest: state.guest,
      loading: state.loading,
    })),
  );

  return (
    <SidebarMenuItem>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.image!} alt={user.name} />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            {user && (
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={user.image!} alt={user.name} />
                    <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Bell />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {!user && !loading && (
        <SidebarMenuButton
          onClick={() => signIn("strava")}
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <Avatar className="h-8 w-8 rounded-lg">
            <AvatarImage src="/icon_strava.svg" alt="Strava" />
            <AvatarFallback className="rounded-lg">ST</AvatarFallback>
          </Avatar>
          <Image
            src="/btn_strava.svg"
            alt="Strava Login Icon"
            width={185}
            height={40}
          />
        </SidebarMenuButton>
      )}
    </SidebarMenuItem>
  );
}

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
          <SidebarGroupLabel>Filter</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <MonthPicker />
              <InequalityFilter name="distance" />
              <InequalityFilter name="total_elevation_gain" />
              <InequalityFilter name="elapsed_time" />
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
