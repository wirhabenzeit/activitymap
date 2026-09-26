'use client';

import { useEffect } from 'react';

import { MoreHorizontal, Search, RotateCcw } from 'lucide-react';

import { useShallowStore } from '~/store';

import * as React from 'react';
import { categorySettings } from '~/settings/category';

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
  useSidebar,
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
import { type SportType } from '~/server/db/schema';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  calendarDateFromLocalDate,
  calendarDateToLocalDate,
  normalizeDateRange,
  type BinaryFilterMode,
} from '~/store/filter';

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
    let singleClickTimer: NodeJS.Timeout | undefined;
    if (clicks === 1) {
      singleClickTimer = setTimeout(function () {
        doSingleClickThing();
        setClicks(0);
      }, 250);
    } else if (clicks >= 2) {
      doDoubleClickThing();
      singleClickTimer = setTimeout(() => {
        setClicks(0);
      }, 0);
    }
    return () => {
      if (singleClickTimer) {
        clearTimeout(singleClickTimer);
      }
    };
  }, [clicks, key, setSportGroup]);

  return (
    <SidebarMenu>
      {Object.entries(categorySettings).map(
        ([id, { name, color, icon: Icon, alias }]) => (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              aria-pressed={
                sportGroup[id as keyof typeof sportGroup] === 'mixed'
                  ? 'mixed'
                  : sportGroup[id as keyof typeof sportGroup]
              }
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
              {sportGroup[id as keyof typeof sportGroup] === 'mixed' ? (
                <span className="sr-only">Some activity types selected</span>
              ) : null}
            </SidebarMenuButton>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction aria-label={`Choose ${name} activity types`}>
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

function InequalityFilterContent({
  operator,
  toggleOperator,
  unit,
  label,
  input,
  validateInput,
}: {
  operator: '>=' | '<=';
  toggleOperator: () => void;
  unit: string;
  label: string;
  input: string;
  validateInput: (value: string) => void;
}) {
  return (
    <span className="relative flex w-full items-center">
      <Button
        className="absolute left-1 h-6 w-6 px-1 py-1 text-foreground/60"
        variant="secondary"
        onClick={toggleOperator}
        aria-label={`Change comparison from ${operator}`}
      >
        {operator}
      </Button>
      <Input
        value={input}
        placeholder="0"
        aria-label={`${label} filter value in ${unit}`}
        inputMode="decimal"
        onChange={(event) => validateInput(event.target.value)}
        className="h-8 w-full pl-8 pr-8 text-right focus-visible:bg-background focus-visible:ring-0"
      />
      <span className="absolute right-2 py-1 text-foreground/60">{unit}</span>
    </span>
  );
}

export function InequalityFilter({
  name,
}: {
  name: keyof typeof inequalityFilters;
}) {
  const [filter, setValues] = useShallowStore((state) => [
    state.values[name],
    state.setValues,
  ]);
  const operator = filter?.operator ?? '>=';
  const input =
    filter?.displayValue ??
    (filter
      ? inequalityFilters[name].fromCanonical(filter.value).toString()
      : '');

  const validateInput = (nextInput: string) => {
    if (nextInput === '') {
      setValues((previous) => ({ ...previous, [name]: undefined }));
      return;
    }

    const number = Number(nextInput);
    if (!Number.isFinite(number)) return;
    setValues((previous) => ({
      ...previous,
      [name]: {
        value: inequalityFilters[name].transform(number),
        operator,
        displayValue: nextInput,
      },
    }));
  };

  const { open } = useSidebar();

  const toggleOperator = () => {
    const next = operator === '>=' ? '<=' : '>=';
    setValues((previous) => ({
      ...previous,
      [name]: {
        value: filter?.value ?? 0,
        operator: next,
      },
    }));
  };

  return (
    <SidebarMenuItem className="peer/menu-button flex w-full items-center gap-0 overflow-hidden rounded-md text-left outline-hidden transition-[width,height,padding] group-data-[collapsible=icon]:size-8! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 h-8 text-sm">
      <Popover>
        <PopoverTrigger asChild>
          <Button className="size-8 px-2" variant="ghost" disabled={open}>
            {inequalityFilters[name].icon}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2">
          <InequalityFilterContent
            operator={operator}
            toggleOperator={toggleOperator}
            unit={inequalityFilters[name].unit}
            label={inequalityFilters[name].label}
            input={input}
            validateInput={validateInput}
          />
        </PopoverContent>
      </Popover>
      <InequalityFilterContent
        operator={operator}
        toggleOperator={toggleOperator}
        unit={inequalityFilters[name].unit}
        label={inequalityFilters[name].label}
        input={input}
        validateInput={validateInput}
      />
    </SidebarMenuItem>
  );
}

export function MonthPicker() {
  const [dates, setDates] = useShallowStore((state) => [
    state.dateRange,
    state.setDateRange,
  ]);
  const [dateError, setDateError] = useState<string>();

  const selectedDates = dates
    ? {
        start: calendarDateToLocalDate(dates.start),
        end: calendarDateToLocalDate(dates.end),
      }
    : undefined;
  const validSelectedDates =
    selectedDates?.start && selectedDates.end
      ? { start: selectedDates.start, end: selectedDates.end }
      : undefined;
  const dateStr = [validSelectedDates?.start, validSelectedDates?.end].map(
    (date) => (date ? format(date, 'MMM yyyy') : undefined),
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
              const start = calendarDateFromLocalDate(range.start);
              const end = calendarDateFromLocalDate(range.end);
              const normalized = normalizeDateRange(start, end);
              if (!normalized) {
                setDateError(
                  'Choose a valid range whose end is on or after its start.',
                );
                return;
              }
              setDateError(undefined);
              setDates(normalized);
            }}
            selectedMonthRange={validSelectedDates}
          />
          {dateError ? (
            <p className="px-3 pb-3 text-sm text-destructive" role="alert">
              {dateError}
            </p>
          ) : null}
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

  const handleChange = (mode: BinaryFilterMode) => {
    setBinary((prev) => ({
      ...prev,
      [name]: mode,
    }));
  };

  const id = React.useId();

  return (
    <SidebarMenuItem className="mx-2 flex h-9 items-center gap-3">
      {binaryFilters[name].icon}
      <label htmlFor={id} className="min-w-16 text-sm font-medium leading-none">
        {binaryFilters[name].label}
      </label>
      <Select
        value={binary}
        onValueChange={(value) => handleChange(value as BinaryFilterMode)}
      >
        <SelectTrigger
          id={id}
          className="ml-auto h-8 w-24"
          aria-label={`${binaryFilters[name].label} filter`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    </SidebarMenuItem>
  );
}

export function SearchFilter() {
  const [search, setSearch] = useShallowStore((state) => [
    state.search,
    state.setSearch,
  ]);

  return (
    <SidebarMenuItem className="relative mx-2">
      <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
      <Input
        aria-label="Search activity names"
        className="h-8 pl-8"
        placeholder="Search activities"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
    </SidebarMenuItem>
  );
}

export function ResetFilters() {
  const resetFilters = useShallowStore((state) => state.resetFilters);

  return (
    <SidebarMenuItem className="mx-2 mt-2">
      <Button className="h-8 w-full" variant="outline" onClick={resetFilters}>
        <RotateCcw />
        Reset filters
      </Button>
    </SidebarMenuItem>
  );
}
