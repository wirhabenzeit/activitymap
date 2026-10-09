'use client';

import { useMemo, useState } from 'react';
import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { categorySettings } from '~/settings/category';
import { formatPreferredDate } from '~/lib/date-preferences';
import {
  metricValue,
  sameDateLastYear,
  sportOrder,
  type Sport,
} from '~/lib/stats/tile-data';
import { dateOfDay } from '~/lib/stats/tile-series';
import {
  monthActivityRhythm,
  yearMonthlyRhythm,
  periodTotal,
  type PeriodSportValues,
} from '~/lib/stats/period-rhythm';
import { cn } from '~/lib/utils';
import { ActivityRow } from './activity-row';
import { formatDailyRate, metricLabel, monthName, statsFormat } from './format';
import { type TileContext } from './tiles';

function SportLegend({ sports }: { sports: readonly Sport[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {sports.map((sport) => (
        <span key={sport} className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: categorySettings[sport].color }}
          />
          {categorySettings[sport].name}
        </span>
      ))}
    </div>
  );
}

export function MonthRhythm({
  context,
  metric,
}: {
  context: TileContext;
  metric: StatsMetric;
}) {
  const rhythm = useMemo(
    () => monthActivityRhythm(context.activities, context.today, metric),
    [context.activities, context.today, metric],
  );
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const selected =
    rhythm.days.find((day) => day.day === selectedDay) ??
    rhythm.days.filter((day) => day.activities.length > 0).at(-1);
  const { formatWithUnit } = statsFormat(context.units);
  const dateLabel = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'short',
      day: 'numeric',
    });
  const maximum =
    Math.max(...rhythm.days.map((day) => periodTotal(day.bySport))) || 1;
  const offset = (dateOfDay(rhythm.days[0]!.day).getUTCDay() + 6) % 7;
  const sports = sportOrder.filter((sport) =>
    rhythm.days.some((day) =>
      day.activities.some((activity) => activity.sport === sport),
    ),
  );
  return (
    <section aria-label="Daily activity" className="min-w-0 space-y-4">
      <h2 className="text-sm font-medium">Your month, day by day</h2>
      <dl className="grid grid-cols-3 gap-3 border-b pb-3">
        <div>
          <dt className="text-[11px] text-muted-foreground">Active days</dt>
          <dd className="mt-1 font-mono text-lg">{rhythm.activeDays}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Activities</dt>
          <dd className="mt-1 font-mono text-lg">{rhythm.activityCount}</dd>
        </div>
        <div
          title={
            metric === 'count'
              ? 'Activities divided by days with an activity.'
              : 'Average includes activities with a recorded value for this metric.'
          }
        >
          <dt className="text-[11px] text-muted-foreground">
            {metric === 'count' ? 'Per active day' : 'Average outing'}
          </dt>
          <dd className="mt-1 font-mono text-lg">
            {rhythm.average === null
              ? '–'
              : metric === 'count'
                ? formatDailyRate(rhythm.average)
                : formatWithUnit(rhythm.average, metric)}
          </dd>
        </div>
      </dl>
      <div>
        <div
          className="mb-1 grid grid-cols-7 text-center text-[10px] text-muted-foreground"
          aria-hidden="true"
        >
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div
          className="grid grid-cols-7 gap-0.5"
          role="group"
          aria-label="Days this month"
        >
          {Array.from({ length: offset }, (_, index) => (
            <span key={`empty-${index}`} />
          ))}
          {rhythm.days.map((day) => {
            const future = day.day > context.today;
            const total = periodTotal(day.bySport);
            const isSelected = day.day === selected?.day;
            return (
              <button
                key={day.day}
                type="button"
                disabled={future}
                aria-pressed={isSelected}
                aria-label={`${dateLabel(day.day)}: ${future ? 'upcoming' : `${day.activities.length} ${day.activities.length === 1 ? 'activity' : 'activities'}, ${formatWithUnit(total, metric)}`}`}
                title={
                  future
                    ? 'Upcoming day'
                    : `${dateLabel(day.day)} · ${formatWithUnit(total, metric)}`
                }
                onClick={() => setSelectedDay(day.day)}
                className={cn(
                  'flex min-h-16 min-w-0 flex-col items-center rounded border p-1 text-[11px] focus-visible:outline-2',
                  isSelected
                    ? 'border-header-background/50 bg-header-background/10'
                    : 'border-transparent bg-muted/35 hover:bg-muted/70',
                  future &&
                    'bg-muted/15 text-muted-foreground/40 hover:bg-muted/15',
                )}
              >
                <span
                  className={cn(
                    'font-mono',
                    day.day === context.today &&
                      'font-bold underline underline-offset-2',
                  )}
                >
                  {dateOfDay(day.day).getUTCDate()}
                </span>
                <span
                  className="mt-1 flex h-8 w-3 flex-col-reverse justify-start"
                  aria-hidden="true"
                >
                  {sportOrder.map(
                    (sport) =>
                      day.bySport[sport] > 0 && (
                        <span
                          key={sport}
                          style={{
                            height: `${(day.bySport[sport] / maximum) * 100}%`,
                            background: categorySettings[sport].color,
                          }}
                        />
                      ),
                  )}
                  {total === 0 && day.activities.length > 0 && (
                    <span className="mb-0.5 flex justify-center gap-0.5">
                      {sportOrder
                        .filter((sport) =>
                          day.activities.some(
                            (activity) => activity.sport === sport,
                          ),
                        )
                        .map((sport) => (
                          <span
                            key={sport}
                            className="size-1 rounded-full"
                            style={{
                              background: categorySettings[sport].color,
                            }}
                          />
                        ))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <SportLegend sports={sports} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Daily {metricLabel[metric].toLowerCase()}. Select a day to inspect its
          activities.
        </p>
      </div>
      <section aria-label="Selected day activities" className="border-t pt-3">
        <h3 className="text-xs font-medium">
          {selected
            ? `${dateLabel(selected.day)} · ${selected.activities.length} ${selected.activities.length === 1 ? 'activity' : 'activities'}`
            : 'No activities this month'}
        </h3>
        {selected?.activities.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No activities on this day.
          </p>
        )}
        <div className="divide-y divide-muted">
          {selected?.activities.map((activity, index) => (
            <ActivityRow
              key={activity.id ?? index}
              activityId={activity.id}
              sport={activity.sport}
              name={activity.name}
              selected={
                activity.id !== undefined &&
                activity.id === context.selectedActivityId
              }
              summary={formatWithUnit(metricValue(activity, metric), metric)}
              onOpen={
                activity.id !== undefined && context.onOpenActivity
                  ? () => context.onOpenActivity!(activity.id!)
                  : undefined
              }
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function StackedMonthBar({
  values,
  maximum,
  previous = false,
  label,
  formatValue,
}: {
  values: PeriodSportValues;
  maximum: number;
  previous?: boolean;
  label: string;
  formatValue: (value: number) => string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted/50"
    >
      {sportOrder.map(
        (sport) =>
          values[sport] > 0 && (
            <span
              key={sport}
              title={`${categorySettings[sport].name}: ${formatValue(values[sport])}`}
              className={previous ? 'opacity-35' : undefined}
              style={{
                width: `${(values[sport] / maximum) * 100}%`,
                background: categorySettings[sport].color,
              }}
            />
          ),
      )}
    </div>
  );
}

export function YearRhythm({
  context,
  metric,
}: {
  context: TileContext;
  metric: StatsMetric;
}) {
  const months = useMemo(
    () => yearMonthlyRhythm(context.activities, context.today, metric),
    [context.activities, context.today, metric],
  );
  const { formatWithUnit } = statsFormat(context.units);
  const year = dateOfDay(context.today).getUTCFullYear();
  const dateLabel = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'short',
      day: 'numeric',
    });
  const previousDate = sameDateLastYear(context.today);
  const through =
    dateLabel(context.today) === dateLabel(previousDate)
      ? `${dateLabel(context.today)} in both years`
      : `${dateLabel(context.today)}, ${year} and ${dateLabel(previousDate)}, ${year - 1}`;
  const formatValue = (value: number) => formatWithUnit(value, metric);
  const maximum =
    Math.max(
      ...months.flatMap((month) => [
        periodTotal(month.current),
        periodTotal(month.previous),
      ]),
    ) || 1;
  const sports = sportOrder.filter((sport) =>
    months.some(
      (month) => month.current[sport] > 0 || month.previous[sport] > 0,
    ),
  );
  return (
    <section aria-label="Monthly activity comparison" className="min-w-0">
      <h2 className="text-sm font-medium">Your year, month by month</h2>
      <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-header-background" />
          {year}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-header-background/35" />
          {year - 1}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {months.map((month) => {
          const name = monthName(dateOfDay(month.start));
          return (
            <div
              key={month.start}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs"
            >
              <span className="row-span-2 self-start pt-0.5 font-medium">
                {name}
                {month.inProgress && (
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    MTD
                  </span>
                )}
              </span>
              <StackedMonthBar
                values={month.current}
                maximum={maximum}
                formatValue={formatValue}
                label={`${name} ${year}: ${formatWithUnit(periodTotal(month.current), metric)}`}
              />
              <span className="font-mono tabular-nums">
                {formatWithUnit(periodTotal(month.current), metric)}
              </span>
              <StackedMonthBar
                values={month.previous}
                maximum={maximum}
                formatValue={formatValue}
                previous
                label={`${name} ${year - 1}: ${formatWithUnit(periodTotal(month.previous), metric)}`}
              />
              <span className="font-mono text-muted-foreground tabular-nums">
                {formatWithUnit(periodTotal(month.previous), metric)}
              </span>
            </div>
          );
        })}
      </div>
      <SportLegend sports={sports} />
      <p className="mt-3 text-[11px] text-muted-foreground">
        Completed months compare in full. The current month compares through{' '}
        {through}. Totals follow your activity filters.
      </p>
    </section>
  );
}
