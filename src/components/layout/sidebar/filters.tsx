'use client';

import {
  Check,
  FunnelX,
  Minus,
  MoreHorizontal,
  Search,
  SquareCheckBig,
} from 'lucide-react';
import { CalendarIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import * as React from 'react';
import { useState } from 'react';

import {
  PreferenceMenuCheckboxItem,
  PreferenceMenuContent,
} from '~/components/preference-menu';
import { TextPlaceFilterChips } from '~/components/text-place-filter-chips';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { MonthRangePicker } from '~/components/ui/monthrangepicker';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '~/components/ui/sidebar';
import { Switch } from '~/components/ui/switch';
import type { SportType } from '~/contracts/sport';
import {
  useActiveFilterCount,
  useFilterResultCount,
} from '~/hooks/use-active-filter-count';
import { useHasBrowsingLibrary } from '~/hooks/use-browsing-library';
import {
  useDateFormat,
  useDisplayUnits,
  useFormattingLocale,
} from '~/hooks/use-display-preferences';
import { message } from '~/lib/presentation/messages';
import { isStatsRoute } from '~/lib/stats/route';
import { measurementScale, measurementUnit } from '~/lib/units';
import { cn } from '~/lib/utils';
import { categorySettings } from '~/settings/category';
import { binaryFilters, inequalityFilters } from '~/settings/filter';
import { useShallowStore } from '~/store';
import {
  type BinaryFilterMode,
  type DateRange,
  calendarDateFromLocalDate,
  calendarDateToLocalDate,
  isolateSportGroup,
  normalizeDateRange,
  parseValueFilterInput,
  toggleSportGroupState,
} from '~/store/filter';

import {
  DATE_PRESETS,
  activeDatePreset,
  datePresetRange,
  formatDateRangeLabel,
  parseDayRangeInput,
  todayCalendarDate,
} from './date-range';

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
      if (key) setSportGroup((group) => isolateSportGroup(group, key));
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
              data-category-state={String(
                sportGroup[id as keyof typeof sportGroup],
              )}
              aria-pressed={
                sportGroup[id as keyof typeof sportGroup] === 'mixed'
                  ? 'mixed'
                  : sportGroup[id as keyof typeof sportGroup]
              }
              onClick={(e) => {
                e.preventDefault();
                // Keyboard/assistive activation has no pointer click count.
                // Apply each command once without the pointer double-click delay.
                if (e.detail === 0) {
                  setSportGroup((group) => ({
                    ...group,
                    [id]: toggleSportGroupState(
                      group[id as keyof typeof group],
                    ),
                  }));
                  return;
                }
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
                <>
                  <Minus
                    className="ml-auto size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="sr-only">Some activity types selected</span>
                </>
              ) : sportGroup[id as keyof typeof sportGroup] ? (
                <Check
                  className="ml-auto size-3.5 shrink-0"
                  aria-hidden="true"
                />
              ) : null}
            </SidebarMenuButton>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction aria-label={`Choose ${name} activity types`}>
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <PreferenceMenuContent side="right" align="start">
                <DropdownMenuItem
                  onSelect={() =>
                    setSportGroup((group) =>
                      isolateSportGroup(group, id as keyof typeof group),
                    )
                  }
                >
                  Only {name}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {(
                  Object.entries(
                    Object.fromEntries(alias.map((a) => [a, sportType[a]])),
                  ) as [SportType, boolean][]
                ).map(([key, selected]) => (
                  <PreferenceMenuCheckboxItem
                    checked={selected}
                    key={key}
                    onCheckedChange={() =>
                      setSportType((type) => ({ ...type, [key]: !type[key] }))
                    }
                  >
                    {key}
                  </PreferenceMenuCheckboxItem>
                ))}
              </PreferenceMenuContent>
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
        className="h-8 w-full pr-8 pl-8 text-right focus-visible:bg-background focus-visible:ring-0"
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

const DATE_RANGE_ERROR =
  'Choose a valid range whose end is on or after its start.';

/** Day-level From / Through fields with an inclusive end. Keyed by the applied
 * range, so the drafts follow it when a preset or the month grid changes it. */
function DayRangeFields({
  range,
  onApply,
}: {
  range: DateRange | undefined;
  onApply: (range: DateRange) => void;
}) {
  const id = React.useId();
  const [from, setFrom] = useState(range?.start ?? '');
  const [through, setThrough] = useState(range?.end ?? '');
  const [error, setError] = useState<string>();
  const parsed = parseDayRangeInput(from, through);

  return (
    <div className="space-y-2 border-t p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-from`}>From</Label>
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setError(undefined);
            }}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-through`}>Through</Label>
          <Input
            id={`${id}-through`}
            type="date"
            value={through}
            onChange={(event) => {
              setThrough(event.target.value);
              setError(undefined);
            }}
            className="h-8"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">The end day is included.</p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={parsed.status === 'empty'}
        onClick={() => {
          if (parsed.status !== 'valid') {
            setError(DATE_RANGE_ERROR);
            return;
          }
          setError(undefined);
          onApply(parsed.range);
        }}
      >
        Apply date range
      </Button>
    </div>
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
  const dateFormat = useDateFormat();
  const locale = useFormattingLocale();

  if (isStatsRoute(pathname)) return null;

  const rangeLabel = dates
    ? formatDateRangeLabel(dates, dateFormat, locale)
    : 'All time';
  const activePreset = activeDatePreset(dates, todayCalendarDate());
  const rangeKey = dates ? `${dates.start}/${dates.end}` : 'none';

  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            className={cn(!dates && 'text-muted-foreground')}
            aria-label={`Date range: ${rangeLabel}`}
            tooltip={`Date range: ${rangeLabel}`}
          >
            <CalendarIcon />
            <span>{rangeLabel}</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <div className="flex flex-wrap gap-1 p-3 pb-0">
            {DATE_PRESETS.map(({ id, label }) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={activePreset === id ? 'default' : 'outline'}
                aria-pressed={activePreset === id}
                onClick={() => {
                  setDateError(undefined);
                  setDates(datePresetRange(id, todayCalendarDate()));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <MonthRangePicker
            key={rangeKey}
            showQuickSelectors={false}
            onMonthRangeSelect={(range) => {
              const start = calendarDateFromLocalDate(range.start);
              const end = calendarDateFromLocalDate(range.end);
              const normalized = normalizeDateRange(start, end);
              if (!normalized) {
                setDateError(DATE_RANGE_ERROR);
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
          <DayRangeFields
            key={rangeKey}
            range={dates}
            onApply={(range) => {
              setDateError(undefined);
              setDates(range);
            }}
          />
          {dates ? (
            <div className="border-t p-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDateError(undefined);
                  setDates(undefined);
                }}
              >
                Clear date range
              </Button>
            </div>
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
        className="h-8 w-24 shrink-0"
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
    <SidebarMenuItem className="mx-2 flex min-h-9 items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4"
      >
        {binaryFilters[name].icon}
      </span>
      <label
        htmlFor={id}
        className="min-w-0 flex-1 text-sm leading-5 font-medium"
      >
        {binaryFilters[name].label}
      </label>
      {control}
    </SidebarMenuItem>
  );
}

/** Header search sets the text and place filters; Filters shows them as
 * removable chips while they are on. */
export function SearchFilter() {
  const active = useShallowStore((state) =>
    Boolean(state.search.trim() || state.place),
  );

  const { state } = useSidebar();
  if (!active) return null;
  const chips = <TextPlaceFilterChips />;

  if (state === 'collapsed') {
    return (
      <CollapsedFilter
        label="Text and place filters"
        icon={<Search />}
        active={active}
      >
        {chips}
      </CollapsedFilter>
    );
  }

  return <SidebarMenuItem className="relative mx-2">{chips}</SidebarMenuItem>;
}

export function SelectedActivitiesFilter() {
  const pathname = usePathname();
  const { onlySelected, setOnlySelected } = useShallowStore((state) => ({
    onlySelected: state.onlySelected,
    setOnlySelected: state.setOnlySelected,
  }));
  const count = useShallowStore((state) => state.selected.length);
  const { state } = useSidebar();
  if (isStatsRoute(pathname)) return null;
  const content = (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-2 text-sm">
      Only selected activities
      <Switch
        aria-label="Only selected activities"
        checked={onlySelected}
        disabled={!count}
        onCheckedChange={(checked) => setOnlySelected(checked)}
      />
    </label>
  );
  if (state === 'collapsed')
    return (
      <CollapsedFilter
        label="Selected activities filter"
        icon={
          <SquareCheckBig
            className={onlySelected ? 'text-header-background' : undefined}
          />
        }
        active={onlySelected}
      >
        {content}
        {!count && (
          <p className="text-xs text-muted-foreground">
            Select activities first.
          </p>
        )}
      </CollapsedFilter>
    );
  return <SidebarMenuItem className="mx-2">{content}</SidebarMenuItem>;
}

/** Stats clears only its own filters; browsing also clears the reporting
 * period and "only selected". */
function useResetFilters() {
  const pathname = usePathname();
  return useShallowStore((state) =>
    isStatsRoute(pathname) ? state.resetActivityFilters : state.resetFilters,
  );
}

export function ResetFilters() {
  const resetFilters = useResetFilters();

  return (
    // Expanded, the reset sits beside the result count (FilterSummary), as on
    // iOS; this one only serves the collapsed icon rail, where that line is hidden.
    <SidebarMenuItem className="mx-2 mt-2 hidden group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:block">
      <SidebarMenuButton
        variant="outline"
        aria-label={message('status.browsing.clearFilters')}
        tooltip={message('status.browsing.clearFilters')}
        onClick={() => {
          resetFilters();
        }}
      >
        <FunnelX />
        <span className="group-data-[collapsible=icon]:hidden">
          {message('status.browsing.clearFilters')}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Result count and active-restriction count, like the native filter panel,
 * with the reset beside the count while any filter is active. */
export function FilterSummary() {
  return useHasBrowsingLibrary() ? <FilterSummaryContent /> : null;
}

function FilterSummaryContent() {
  const result = useFilterResultCount();
  const active = useActiveFilterCount();
  const resetFilters = useResetFilters();
  if (!result) return null;
  return (
    <div
      data-filter-summary
      className="flex items-start justify-between gap-2 px-2 py-1 group-data-[collapsible=icon]:hidden"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {result.shown.toLocaleString()} of {result.total.toLocaleString()}{' '}
          activities
        </p>
        {active > 0 && (
          <p className="text-xs text-muted-foreground">
            {active} active {active === 1 ? 'filter' : 'filters'}
          </p>
        )}
      </div>
      {active > 0 && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto shrink-0 px-1 py-0.5"
          onClick={() => {
            resetFilters();
          }}
        >
          {message('status.browsing.clearFilters')}
        </Button>
      )}
    </div>
  );
}
