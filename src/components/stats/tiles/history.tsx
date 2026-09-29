'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog';
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
  type HistoryRange,
} from '~/lib/stats/history';
import {
  dailyTotals,
  dateOfDay,
  monthStart,
  yearStart,
} from '~/lib/stats/tile-series';
import { MonthRows } from './calendar';
import { Measure, SportBars } from './charts';
import { formatWithUnit, monthName, shortDate } from './format';
import { type TileContext } from './tiles';

const dateLabel = (day: number) =>
  `${shortDate(dateOfDay(day))}, ${dateOfDay(day).getUTCFullYear()}`;

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
  const [range, setRange] = useState<HistoryRange>('weeks');
  const [page, setPage] = useState(0);
  const buckets = useMemo(
    () => volumeHistory(context.activities, context.today, metric, range, page),
    [context.activities, context.today, metric, range, page],
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
      <div
        role="group"
        aria-label="Volume history range"
        className="flex flex-wrap gap-1"
      >
        {(
          [
            ['weeks', '12 weeks'],
            ['months', '12 months'],
            ['years', 'All years'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={range === value ? 'secondary' : 'ghost'}
            aria-pressed={range === value}
            className="h-8 px-2 text-xs"
            onClick={() => {
              setRange(value);
              setPage(0);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {range !== 'years' ? (
        <PeriodNavigation
          label={`${dateLabel(first)} – ${dateLabel(last)}`}
          previous={first > firstActivityDay(context.activities, context.today)}
          next={page > 0}
          onPrevious={() => setPage(page + 1)}
          onNext={() => setPage(Math.max(0, page - 1))}
          onReset={() => setPage(0)}
        />
      ) : (
        <p className="text-xs">
          {dateLabel(first)} – {dateLabel(last)}
        </p>
      )}
      <div>
        <p className="text-xs text-muted-foreground">
          Total across{' '}
          {range === 'years'
            ? 'all displayed years'
            : `the displayed 12 ${range}`}
          {page === 0 ? ' · current period is incomplete' : ''}
        </p>
        <p className="font-mono text-2xl">
          {formatWithUnit(
            buckets.reduce((sum, bucket) => sum + bucket.total, 0),
            metric,
          )}
        </p>
      </div>
      <Measure className="w-full" style={{ height: 240 }}>
        {({ width, height }) => (
          <SportBars
            rows={rows}
            width={width}
            height={height}
            detail
            partialLast={page === 0}
            trend={
              range === 'weeks'
                ? buckets.flatMap((bucket, index) =>
                    index >= 3 && (page > 0 || index < buckets.length - 1)
                      ? [
                          {
                            x: String(bucket.start),
                            value:
                              buckets
                                .slice(index - 3, index + 1)
                                .reduce((sum, row) => sum + row.total, 0) / 4,
                          },
                        ]
                      : [],
                  )
                : []
            }
            palette={context.palette}
            valueFormat={(value) => formatWithUnit(value, metric)}
            xTickFormat={(value) =>
              range === 'years'
                ? label(Number(value))
                : shortDate(dateOfDay(Number(value)))
            }
          />
        )}
      </Measure>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {range === 'weeks' && <span>Line: 4-week average</span>}
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
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left">
                {range === 'years'
                  ? 'Year'
                  : range === 'months'
                    ? 'Month'
                    : 'Week'}
              </th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.start} className="border-b border-muted">
                <td className="py-2">{label(bucket.start)}</td>
                <td className="text-right font-mono">
                  {formatWithUnit(bucket.total, metric)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const { days, dominantSport, mixedDays } = useMemo(
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
              className="size-8"
              aria-label="Previous calendar year"
              disabled={(year ?? currentYear) <= earliestYear}
              onClick={() => {
                setYear((year ?? currentYear) - 1);
                setSelectedDay(null);
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <label className="text-xs">
              <span className="sr-only">Calendar period</span>
              <select
                aria-label="Calendar period"
                className="h-8 rounded border bg-background px-2"
                value={year ?? 'rolling'}
                onChange={(event) => {
                  setYear(
                    event.target.value === 'rolling'
                      ? null
                      : Number(event.target.value),
                  );
                  setSelectedDay(null);
                }}
              >
                <option value="rolling">Last 12 months</option>
                {Array.from(
                  {
                    length:
                      currentYear -
                      Math.min(earliestYear, year ?? earliestYear) +
                      1,
                  },
                  (_, i) => currentYear - i,
                ).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
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
      <div
        className={
          expanded ? 'flex h-[380px] flex-col' : 'flex min-h-0 flex-1 flex-col'
        }
      >
        <MonthRows
          key={`${first}-${last}`}
          today={last}
          first={first}
          dominantSport={dominantSport}
          mixedDays={mixedDays}
          totals={totals}
          palette={context.palette}
          colorBy={colorBy}
          onSelectDay={setSelectedDay}
          footer={
            <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] leading-4 text-muted-foreground">
              {sportOrder
                .filter((sport) => [...dominantSport.values()].includes(sport))
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
      <Dialog
        open={selectedDay !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDay(null);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto"
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <DialogTitle>
            {selectedDay === null ? 'Day activities' : dateLabel(selectedDay)}
          </DialogTitle>
          <DialogDescription>
            Activities matching your current filters.
          </DialogDescription>
          {selectedActivities.length === 0 ? (
            <p className="text-sm">No matching activities on this day.</p>
          ) : (
            <ul className="space-y-3">
              {selectedActivities.map((activity, index) => (
                <li key={activity.id ?? index} className="rounded border p-3">
                  {activity.id !== undefined && context.onOpenActivity ? (
                    <button
                      className="text-left text-sm font-medium underline underline-offset-2"
                      onClick={() => {
                        setSelectedDay(null);
                        context.onOpenActivity?.(activity.id!);
                      }}
                    >
                      {activity.name?.trim()
                        ? activity.name
                        : 'Untitled activity'}
                    </button>
                  ) : (
                    <p className="text-sm font-medium">
                      {activity.name?.trim()
                        ? activity.name
                        : 'Untitled activity'}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {categorySettings[activity.sport].name} ·{' '}
                    {(['distance', 'elevation', 'time'] as const)
                      .map((metric) =>
                        formatWithUnit(metricValue(activity, metric), metric),
                      )
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
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
