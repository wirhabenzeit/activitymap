'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { MoreHorizontal, Search, FunnelX } from 'lucide-react';

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

import { useDisplayUnits } from '~/hooks/use-display-preferences';
import { measurementScale, measurementUnit } from '~/lib/units';
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
  parseValueFilterInput,
  toggleSportGroupState,
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
      if (key)
        setSportGroup((group) => ({
          ...group,
          [key]: toggleSportGroupState(group[key]),
        }));
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

// Collapsed controls need their own content surface: clipping a full form leaves
// invisible focus targets and unreadable labels in the icon rail.
function CollapsedFilter({
  label,
  icon,
  active = false,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            aria-label={label}
            tooltip={label}
            isActive={active}
          >
            {icon}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          aria-label={label}
          className="w-64 space-y-2 p-3"
        >
          <p className="text-sm font-medium">{label}</p>
          {children}
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
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
  const units = useDisplayUnits();
  const spec = inequalityFilters[name];
  const scale =
    'measurement' in spec
      ? measurementScale(spec.measurement, units)
      : spec.scale;
  const unit =
    'measurement' in spec
      ? measurementUnit(spec.measurement, units)
      : spec.unit;
  const [filter, setValues, setValueOperator] = useShallowStore((state) => [
    state.values[name],
    state.setValues,
    state.setValueOperator,
  ]);
  const [pendingOperator, setPendingOperator] = useState<'>=' | '<='>('>=');
  const operator = filter?.operator ?? pendingOperator;
  // Keep the typed text while it still describes the filter in the current
  // units; after a unit switch, show the converted physical threshold.
  const input = filter
    ? filter.displayValue !== undefined &&
      Number(filter.displayValue) * scale === filter.value
      ? filter.displayValue
      : Number((filter.value / scale).toPrecision(12)).toString()
    : '';

  const validateInput = (nextInput: string) => {
    const parsed = parseValueFilterInput(
      nextInput,
      operator,
      (value) => value * scale,
    );
    if (parsed.status === 'empty') {
      setPendingOperator(operator);
      setValues((previous) => ({ ...previous, [name]: undefined }));
      return;
    }
    if (parsed.status === 'invalid') return;
    setValues((previous) => ({
      ...previous,
      [name]: parsed.filter,
    }));
  };

  const { state } = useSidebar();

  const toggleOperator = () => {
    const next = operator === '>=' ? '<=' : '>=';
    setPendingOperator(next);
    setValueOperator(name, next);
  };

  const content = (
    <InequalityFilterContent
      operator={operator}
      toggleOperator={toggleOperator}
      unit={unit}
      label={inequalityFilters[name].label}
      input={input}
      validateInput={validateInput}
    />
  );

  if (state === 'collapsed') {
    return (
      <CollapsedFilter
        label={`${inequalityFilters[name].label} filter`}
        icon={inequalityFilters[name].icon}
        active={Boolean(filter)}
      >
        {content}
      </CollapsedFilter>
    );
  }

  return (
    <SidebarMenuItem className="flex h-8 w-full items-center text-sm">
      <span className="flex size-8 shrink-0 items-center justify-center [&>svg]:size-4">
        {inequalityFilters[name].icon}
      </span>
      {content}
    </SidebarMenuItem>
  );
}

export function MonthPicker() {
  const pathname = usePathname();
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

  if (pathname === '/stats/tiles') return null;

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

  const { state } = useSidebar();
  const control = (
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
  );

  if (state === 'collapsed') {
    return (
      <CollapsedFilter
        label={`${binaryFilters[name].label} filter`}
        icon={binaryFilters[name].icon}
        active={binary !== 'any'}
      >
        {control}
      </CollapsedFilter>
    );
  }

  return (
    <SidebarMenuItem className="mx-2 flex h-9 items-center gap-3">
      {binaryFilters[name].icon}
      <label htmlFor={id} className="min-w-16 text-sm font-medium leading-none">
        {binaryFilters[name].label}
      </label>
      {control}
    </SidebarMenuItem>
  );
}

export function SearchFilter() {
  const [search, setSearch] = useShallowStore((state) => [
    state.search,
    state.setSearch,
  ]);

  const { state } = useSidebar();
  const input = (
    <Input
      aria-label="Search activity names"
      className={cn('h-8', state === 'expanded' && 'pl-8')}
      placeholder="Search activities"
      type="search"
      value={search}
      onChange={(event) => setSearch(event.target.value)}
    />
  );

  if (state === 'collapsed') {
    return (
      <CollapsedFilter
        label="Search activities"
        icon={<Search />}
        active={Boolean(search)}
      >
        {input}
      </CollapsedFilter>
    );
  }

  return (
    <SidebarMenuItem className="relative mx-2">
      <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
      {input}
    </SidebarMenuItem>
  );
}

export function ResetFilters() {
  const pathname = usePathname();
  const resetFilters = useShallowStore((state) =>
    pathname === '/stats/tiles'
      ? state.resetActivityFilters
      : state.resetFilters,
  );

  return (
    <SidebarMenuItem className="mx-2 mt-2 group-data-[collapsible=icon]:mx-0">
      <SidebarMenuButton
        variant="outline"
        aria-label="Clear filters"
        tooltip="Clear filters"
        onClick={resetFilters}
      >
        <FunnelX />
        <span className="group-data-[collapsible=icon]:hidden">
          Clear filters
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
