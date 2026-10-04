'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '~/components/ui/select';
import { categorySettings } from '~/settings/category';
import { type StatsMetric } from '~/settings/stats-tiles.generated';
import {
  sameDateLastYear,
  metricValue,
  sportOrder,
} from '~/lib/stats/tile-data';
import {
  calendarDays,
  firstActivityDay,
  volumeHistory,
  volumeHistoryAverage,
  type HistoryRange,
} from '~/lib/stats/history';
import {
  dailyTotals,
  dateOfDay,
  monthStart,
  yearStart,
} from '~/lib/stats/tile-series';
import { ActivityRow } from './activity-row';
import { MonthRows } from './calendar';
import { Measure, SportArea } from './charts';
import { formatPreferredDate } from '~/lib/date-preferences';
import { statsFormat, monthName, shortDate } from './format';
import { type TileContext } from './tiles';

function PeriodNavigation({
  label,
  previous,
  next,
  onPrevious,
  onNext,
  onReset,
}: {
  label: string;
  previous: boolean;
  next: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Previous period"
        disabled={!previous}
        onClick={onPrevious}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="text-xs" aria-live="polite">
        {label}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Next period"
        disabled={!next}
        onClick={onNext}
      >
        <ChevronRight className="size-4" />
      </Button>
      {next && (
        <Button variant="ghost" className="h-8 px-2 text-xs" onClick={onReset}>
          Latest
        </Button>
      )}
    </div>
  );
}

export function VolumeHistory({
  context,
  metric,
}: {
  context: TileContext;
  metric: StatsMetric;
}) {
  const { formatWithUnit, formatShort } = statsFormat(context.units);
  const dateLabel = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const [range, setRange] = useState<HistoryRange>('weeks');
  const buckets = useMemo(
    () => volumeHistory(context.activities, context.today, metric, range),
    [context.activities, context.today, metric, range],
  );
  const trend = useMemo(
    () =>
      volumeHistoryAverage(context.activities, context.today, metric, range),
    [context.activities, context.today, metric, range],
  );
  const averageLabel = `4-${range === 'weeks' ? 'week' : range === 'months' ? 'month' : 'year'} average`;
  const sports = sportOrder.filter((sport) =>
    buckets.some((bucket) => bucket.bySport[sport] > 0),
  );
  const first = buckets[0]!.start;
  const last = buckets.at(-1)!.end;
  const label = (start: number) =>
    range === 'years'
      ? String(dateOfDay(start).getUTCFullYear())
      : range === 'months'
        ? `${monthName(dateOfDay(start))} ${dateOfDay(start).getUTCFullYear()}`
        : `Week of ${dateLabel(start)}`;
  const rows = buckets.flatMap((bucket) =>
    sportOrder.map((sport) => ({
      x: String(bucket.start),
      sport,
      value: bucket.bySport[sport],
    })),
  );
  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={range}
          onValueChange={(value) => setRange(value as HistoryRange)}
        >
          <SelectTrigger
            aria-label="Volume grouping"
            className="w-auto min-w-32 gap-3 text-xs"
          >
            <SelectValue>
              {range === 'weeks'
                ? 'By week'
                : range === 'months'
                  ? 'By month'
                  : 'By year'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weeks">By week</SelectItem>
            <SelectItem value="months">By month</SelectItem>
            <SelectItem value="years">By year</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {dateLabel(first)} – {dateLabel(last)}
        </p>
      </div>
      <p className="font-mono text-2xl">
        {formatWithUnit(
          buckets.reduce((sum, bucket) => sum + bucket.total, 0),
          metric,
        )}{' '}
        <span className="font-sans text-xs text-muted-foreground">
          {range === 'years' ? 'over all years' : `over 12 ${range}`}
        </span>
      </p>
      <Measure className="w-full" style={{ height: 240 }}>
        {({ width, height }) => (
          <SportArea
            rows={rows}
            width={width}
            height={height}
            detail
            incomplete={buckets.flatMap((bucket) =>
              bucket.incomplete ? [String(bucket.start)] : [],
            )}
            trend={trend}
            trendLabel={averageLabel}
            palette={context.palette}
            valueFormat={(value) => formatWithUnit(value, metric)}
            axisFormat={(value, step) => formatShort(value, metric, step)}
            xTickFormat={(value) =>
              range === 'years'
                ? label(Number(value))
                : range === 'months'
                  ? monthName(dateOfDay(Number(value)))
                  : shortDate(dateOfDay(Number(value)))
            }
          />
        )}
      </Measure>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {trend.length > 0 && <span>Dashed: {averageLabel}</span>}
        {sportOrder
          .filter((sport) =>
            buckets.some((bucket) => bucket.bySport[sport] > 0),
          )
          .map((sport) => (
            <span key={sport} className="flex items-center gap-1">
              <i
                className="size-2 rounded-sm"
                style={{ background: categorySettings[sport].color }}
              />
              {categorySettings[sport].name}
            </span>
          ))}
      </div>
      <details>
        <summary className="cursor-pointer py-2 text-xs">Period totals</summary>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Period totals by sport"
        >
          <table className="w-full text-xs whitespace-nowrap">
            <caption className="sr-only">
              Period totals by sport, {metric}. Incomplete periods are marked.
            </caption>
            <thead>
              <tr className="border-b">
                <th
                  scope="col"
                  className="sticky left-0 bg-card py-2 pr-4 text-left"
                >
                  {range === 'years'
                    ? 'Year'
                    : range === 'months'
                      ? 'Month'
                      : 'Week'}
                </th>
                {sports.map((sport) => (
                  <th scope="col" key={sport} className="px-3 text-right">
                    {categorySettings[sport].name}
                  </th>
                ))}
                <th scope="col" className="pl-3 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.start} className="border-b border-muted">
                  <th
                    scope="row"
                    className="sticky left-0 bg-card py-2 pr-4 text-left font-normal"
                  >
                    {label(bucket.start)}
                    {bucket.incomplete && (
                      <span className="text-muted-foreground">
                        {' '}
                        · incomplete
                      </span>
                    )}
                  </th>
                  {sports.map((sport) => (
                    <td key={sport} className="px-3 text-right font-mono">
                      {formatWithUnit(bucket.bySport[sport], metric)}
                    </td>
                  ))}
                  <td className="pl-3 text-right font-mono font-semibold">
                    {formatWithUnit(bucket.total, metric)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function CalendarHistory({
  context,
  colorBy,
  expanded,
}: {
  context: TileContext;
  colorBy: 'sport' | StatsMetric;
  expanded: boolean;
}) {
  const { formatWithUnit } = statsFormat(context.units);
  const dateLabel = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const currentYear = dateOfDay(context.today).getUTCFullYear();
  const earliestYear = dateOfDay(
    firstActivityDay(context.activities, context.today),
  ).getUTCFullYear();
  const [year, setYear] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const selectedYear = expanded ? year : null;
  const first =
    selectedYear === null
      ? sameDateLastYear(context.today)
      : yearStart(selectedYear);
  const last =
    selectedYear === null
      ? context.today
      : Math.min(context.today, yearStart(selectedYear + 1) - 1);
  const { days, dominantSport, secondSport, mixedDays } = useMemo(
    () => calendarDays(context.activities, first, last),
    [context.activities, first, last],
  );
  const totals = useMemo(
    () => dailyTotals(context.activities, first, last),
    [context.activities, first, last],
  );
  const selectedActivities =
    selectedDay === null ? [] : (days.get(selectedDay) ?? []);
  return (
    <>
      {expanded && (
        <div className="space-y-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-11"
              aria-label="Previous calendar year"
              disabled={(year ?? currentYear) <= earliestYear}
              onClick={() => {
                setYear((year ?? currentYear) - 1);
                setSelectedDay(null);
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Select
              value={year === null ? 'rolling' : String(year)}
              onValueChange={(value) => {
                setYear(value === 'rolling' ? null : Number(value));
                setSelectedDay(null);
              }}
            >
              <SelectTrigger
                aria-label="Calendar period"
                className="h-11 w-[170px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rolling">Last 12 months</SelectItem>
                {Array.from(
                  {
                    length:
                      currentYear -
                      Math.min(earliestYear, year ?? earliestYear) +
                      1,
                  },
                  (_, i) => currentYear - i,
                ).map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="size-11"
              aria-label="Next calendar year"
              disabled={year === null || year >= currentYear}
              onClick={() => {
                setYear(Math.min(currentYear, (year ?? currentYear) + 1));
                setSelectedDay(null);
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <p className="text-sm">
            <strong className="font-mono">{days.size}</strong> active days ·{' '}
            {dateLabel(first)} – {dateLabel(last)}
          </p>
        </div>
      )}
      {!expanded && (
        <div className="space-y-1">
          <p>
            <strong className="font-mono text-[28px] font-medium">
              {days.size}
            </strong>
            <span className="ml-1 text-xs text-muted-foreground">
              active days
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {Math.round((days.size / (last - first + 1)) * 100)}% of days in the
            last 12 months
          </p>
        </div>
      )}
      <div
        className={
          expanded ? 'flex h-[380px] flex-col' : 'flex min-h-0 flex-1 flex-col'
        }
      >
        <MonthRows
          units={context.units}
          dateFormat={context.dateFormat}
          key={`${first}-${last}`}
          today={last}
          first={first}
          dominantSport={dominantSport}
          secondSport={secondSport}
          mixedDays={mixedDays}
          totals={totals}
          palette={context.palette}
          colorBy={colorBy}
          selectedDay={selectedDay}
          onSelectDay={(day) => {
            setSelectedDay(day);
            if (!expanded) {
              setYear(null);
              context.onExpand?.();
            }
          }}
          footer={
            <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] leading-4 text-muted-foreground">
              {sportOrder
                .filter((sport) =>
                  [...days.values()].some((activities) =>
                    activities.some((activity) => activity.sport === sport),
                  ),
                )
                .map((sport) => (
                  <span key={sport} className="flex items-center gap-1">
                    <i
                      className="size-2"
                      style={{ background: categorySettings[sport].color }}
                    />
                    {categorySettings[sport].name}
                  </span>
                ))}
              {mixedDays.size > 0 && <span>Striped: multiple sports</span>}
            </div>
          }
        />
      </div>
      {selectedDay !== null && selectedDay >= first && selectedDay <= last && (
        <section
          className="mt-3 space-y-3 border-t pt-3"
          aria-label="Selected day activities"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium">{dateLabel(selectedDay)}</h4>
            <Button
              variant="ghost"
              className="h-11"
              aria-label="Close day details"
              onClick={() => setSelectedDay(null)}
            >
              Close
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Activities matching your current filters.
          </p>
          {selectedActivities.length === 0 ? (
            <p className="text-sm">No matching activities on this day.</p>
          ) : (
            <ul className="divide-y divide-muted">
              {selectedActivities.map((activity, index) => (
                <li key={activity.id ?? index}>
                  <ActivityRow
                    sport={activity.sport}
                    name={activity.name}
                    summary={`${categorySettings[activity.sport].name} · ${(
                      ['distance', 'elevation', 'time'] as const
                    )
                      .map((metric) =>
                        formatWithUnit(metricValue(activity, metric), metric),
                      )
                      .join(' · ')}`}
                    onOpen={
                      activity.id !== undefined && context.onOpenActivity
                        ? () => context.onOpenActivity?.(activity.id!)
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

export function ComparisonHistory({
  context,
  period,
  children,
}: {
  context: TileContext;
  period: 'year' | 'month';
  children: (context: TileContext) => ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const date = dateOfDay(context.today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const first =
    period === 'year'
      ? yearStart(year - offset)
      : monthStart(year, month - offset);
  const end =
    offset === 0
      ? context.today
      : period === 'year'
        ? yearStart(year - offset + 1) - 1
        : monthStart(year, month - offset + 1) - 1;
  return (
    <div className="space-y-3 pt-2">
      <PeriodNavigation
        label={
          period === 'year'
            ? String(dateOfDay(first).getUTCFullYear())
            : `${monthName(dateOfDay(first))} ${dateOfDay(first).getUTCFullYear()}`
        }
        previous={first > firstActivityDay(context.activities, context.today)}
        next={offset > 0}
        onPrevious={() => setOffset(offset + 1)}
        onNext={() => setOffset(Math.max(0, offset - 1))}
        onReset={() => setOffset(0)}
      />
      {children({ ...context, today: end })}
    </div>
  );
}
