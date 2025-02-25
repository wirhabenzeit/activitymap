'use client';

import { useEffect } from 'react';

import { MoreHorizontal } from 'lucide-react';

import { useShallowStore } from '~/store';

import * as React from 'react';
import { categorySettings } from '~/settings/category';

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
} from '~/components/ui/sidebar';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '~/components/ui/dropdown-menu';

import { MonthRangePicker } from '~/components/ui/monthrangepicker';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { CalendarIcon } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';

import { format } from 'date-fns/format';

import { useState } from 'react';
import { cn } from '~/lib/utils';

import { binaryFilters, inequalityFilters } from '~/settings/filter';
import { Checkbox } from '../ui/checkbox';
import { type SportType } from '~/server/db/schema';

export function CategoryFilter() {
  const { sportType, sportGroup, setSportGroup, setSportType } =
    useShallowStore((state) => ({
      sportType: state.sportType,
      sportGroup: state.sportGroup,
      setSportGroup: state.setSportGroup,
      setSportType: state.setSportType,
    }));
  const [clicks, setClicks] = useState(0);
  const [key, setKey] = useState<keyof typeof categorySettings | undefined>(
    undefined,
  );

  useEffect(() => {
    const doSingleClickThing = () => {
      if (key) setSportGroup((group) => ({ ...group, [key]: !group[key] }));
    };

    const doDoubleClickThing = () => {
      if (key)
        setSportGroup(
          (group) =>
            Object.fromEntries(
              Object.keys(group).map((k) => [k, k === key]),
            ) as Record<keyof typeof categorySettings, boolean>,
        );
    };
    let singleClickTimer: NodeJS.Timeout;
    if (clicks === 1) {
      singleClickTimer = setTimeout(function () {
        doSingleClickThing();
        setClicks(0);
      }, 250);
    } else if (clicks >= 2) {
      doDoubleClickThing();
      setClicks(0);
    }
    return () => clearTimeout(singleClickTimer);
  }, [clicks, key, setSportGroup]);

  return (
    <SidebarMenu>
      {Object.entries(categorySettings).map(
        ([id, { name, color, icon: Icon, alias }]) => (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              onClick={(e) => {
                e.preventDefault();
                setClicks(clicks + 1);
                setKey(id as keyof typeof categorySettings);
              }}
            >
              {sportGroup[id as keyof typeof sportGroup] ? (
                <Icon color={color} />
              ) : (
                <Icon className="text-foreground/60" />
              )}
              <span
                className={
                  sportGroup[id as keyof typeof sportGroup]
                    ? 'text-foreground'
                    : 'text-foreground/60'
                }
              >
                {name}
              </span>
            </SidebarMenuButton>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction>
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                className="max-h-96 overflow-scroll!"
              >
                {(
                  Object.entries(
                    Object.fromEntries(alias.map((a) => [a, sportType[a]])),
                  ) as [SportType, boolean][]
                ).map(([key, selected]) => (
                  <DropdownMenuCheckboxItem
                    checked={selected}
                    key={key}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() =>
                      setSportType((type) => ({ ...type, [key]: !type[key] }))
                    }
                  >
                    {key}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ),
      )}
    </SidebarMenu>
  );
}

export function InequalityFilter({
  name,
}: {
  name: keyof typeof inequalityFilters;
}) {
  const [operator, setOperator] = useState<'>=' | '<='>('>=' as const);
  const [input, setInput] = useState('');
  const [value, setValue] = useState(0.0);

  const validateInput = (value: string) => {
    const number = parseFloat(value);
    if (!isNaN(number)) {
      setInput(value);
      setValue(number);
    }
  };

  const setValues = useShallowStore((state) => state.setValues);

  React.useEffect(() => {
    const transformed = inequalityFilters[name].transform(value);
    setValues((prev) => ({
      ...prev,
      [name]: input === '' ? undefined : { value: transformed, operator },
    }));
  }, [operator, value, input, name, setValues]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className="pr-0">
        <div>
          {inequalityFilters[name].icon}
          <span className="relative flex w-full items-center">
            <Button
              className="absolute left-1 h-6 w-6 px-1 py-1 text-foreground/60"
              variant="secondary"
              onClick={() => setOperator((op) => (op === '>=' ? '<=' : '>='))}
            >
              {operator}
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

export function MonthPicker() {
  const [dates, setDates] = useShallowStore((state) => [
    state.dateRange,
    state.setDateRange,
  ]);

  const dateStr = [dates?.start, dates?.end].map((date) =>
    date ? format(date, 'MMM yyyy') : undefined,
  );

  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger asChild>
          <SidebarMenuButton className={cn(!dates && 'text-muted-foreground')}>
            <CalendarIcon />
            {dates == undefined ? (
              <span>Pick a month range</span>
            ) : dateStr[0] == dateStr[1] ? (
              <span>{dateStr[0]}</span>
            ) : (
              <span>
                {dateStr[0]} - {dateStr[1]}
              </span>
            )}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <MonthRangePicker
            onMonthRangeSelect={(range) => {
              console.log(range);
              setDates(range);
            }}
            selectedMonthRange={dates}
          />
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}

export function BinaryFilter({ name }: { name: keyof typeof binaryFilters }) {
  const [binary, setBinary] = useShallowStore((state) => [
    state.binary[name],
    state.setBinary,
  ]);

  const handleChange = () => {
    setBinary((prev) => ({
      ...prev,
      [name]: binary === undefined ? true : !binary,
    }));
  };

  return (
    <SidebarMenuItem className="flex items-center gap-4 h-8 mx-2">
      {binaryFilters[name].icon}
      <label
        htmlFor="terms"
        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {binaryFilters[name].label}
      </label>
      <Checkbox
        checked={binary ?? 'indeterminate'}
        onCheckedChange={handleChange}
      />
    </SidebarMenuItem>
  );
}
