'use client';

// What each tile shows on its face and in its detail view. The switch over
// StatsTileID is exhaustive, so a tile added to shared/stats-tiles.json
// fails the build here until it has a view.

import { type ReactNode } from 'react';

import { categorySettings } from '~/settings/category';
import {
  type StatsMetric,
  type StatsTileID,
} from '~/settings/stats-tiles.generated';
import {
  activityCalendar,
  mondayOf,
  consistency,
  distanceVsElevation,
  monthVsLastMonth,
  sportMix,
  weeklyVolume,
  yearToDate,
  type Sport,
  type StatsActivity,
} from '~/lib/stats/tile-data';
import {
  activeDaysPerWeek,
  activeDayFlags,
  bestWindow,
  climbRate,
  climbRateByMonth,
  cumulativeByDay,
  dailyTotals,
  dateOfDay,
  monthStart,
  records,
  sportBreakdown,
  thisWeekByDay,
  typicalThroughWeekday,
  typicalWeek,
  weeklyVolumeBySport,
  yearPace,
  yearStart,
} from '~/lib/stats/tile-series';
import { cn } from '~/lib/utils';

import { CalendarHeatmap, MonthRows, type CalendarColour } from './calendar';
import {
  CumulativeLines,
  DistanceElevationDots,
  Measure,
  PlainBars,
  SportBars,
  VolumeArea,
  type LineSeries,
} from './charts';
import {
  formatMetric,
  formatWithUnit,
  metricLabel,
  metricUnit,
  monthName,
  percentChange,
  shortDate,
  type TilePalette,
} from './format';

export type TileContext = {
  activities: StatsActivity[];
  today: number;
  palette: TilePalette;
};

export type TileSummary = { value: string; unit: string; sub: ReactNode };

export type TileView = {
  period: (context: TileContext) => string;
  // Null leaves the face without a headline number.
  summary: (
    context: TileContext,
    option: string | undefined,
  ) => TileSummary | null;
  // The face's own small switch (first option is the default), if any.
  faceOptions?: readonly string[];
  face: (context: TileContext, option: string | undefined) => ReactNode;
  // The drill-down panel's content, for tiles that have one.
  detail?: (context: TileContext, option: string | undefined) => ReactNode;
};

const metricFaceOptions = ['distance', 'time', 'elevation'] as const;

// Short labels for the face switches, which have little room.
export const faceOptionLabels: Record<string, string> = {
  distance: 'km',
  time: 'h',
  elevation: 'm',
};

export const optionLabels: Record<string, string> = {
  ...metricLabel,
  sport: 'Sport',
  currentYear: 'This year',
  allTime: 'All time',
  last12Weeks: '12 weeks',
  last52Weeks: '52 weeks',
};

const signed = (value: number, format: (value: number) => string) =>
  `${value >= 0 ? '+' : '−'}${format(Math.abs(value))}`;

// "+1,260 km · +15% vs 2025 by Sep 26": the absolute difference (when a
// metric is given) and the percentage, coloured by direction.
function Delta({
  current,
  previous,
  text,
  metric,
}: {
  current: number;
  previous: number;
  text: string;
  metric?: StatsMetric;
}) {
  const change = percentChange(current, previous);
  if (change === null) return <>{text}</>;
  return (
    <>
      <span
        className={cn(
          change >= 0
            ? 'text-green-700 dark:text-green-400'
            : 'text-orange-700 dark:text-orange-400',
        )}
      >
        {metric &&
          `${signed(current - previous, (value) => formatWithUnit(value, metric))} · `}
        {signed(change, String)}%
      </span>{' '}
      {text}
    </>
  );
}

function FillChart({
  children,
}: {
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  return <Measure className="mt-2 min-h-0 flex-1">{children}</Measure>;
}

function DetailChart({
  height = 280,
  children,
}: {
  height?: number;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  return (
    <Measure className="w-full" style={{ height }}>
      {children}
    </Measure>
  );
}

function Legend({ sports }: { sports: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {sports.map((sport) => {
        const setting =
          categorySettings[sport as keyof typeof categorySettings];
        return (
          <span key={sport} className="flex items-center gap-1">
            <i
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: setting.color }}
            />
            {setting.name}
          </span>
        );
      })}
    </div>
  );
}

// One line of sports, as many as fit, for a tile face.
function SportLegend({ sports }: { sports: Sport[] }) {
  return (
    <div className="mt-1.5 flex h-4 shrink-0 flex-wrap gap-x-2.5 overflow-hidden text-[11px] leading-4 text-muted-foreground">
      {sports.map((sport) => (
        <span key={sport} className="flex items-center gap-1">
          <i
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: categorySettings[sport].color }}
          />
          {categorySettings[sport].name}
        </span>
      ))}
    </div>
  );
}

// A small labelled number for the stat grids on tile faces.
// A stat label with the swatch of the chart mark it names.
function LegendLabel({
  swatch,
  children,
}: {
  swatch: string;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1">
      <i
        className={cn('inline-block h-2 w-2 shrink-0 rounded-[2px]', swatch)}
      />
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  unit,
  note,
  large = false,
}: {
  label: ReactNode;
  value: string;
  unit?: string;
  note?: string;
  large?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'truncate font-mono font-medium tabular-nums',
          large ? 'text-[20px] leading-tight' : 'text-[15px]',
        )}
      >
        {value}
        {unit && (
          <small className="ml-0.5 font-sans text-[11px] font-normal text-muted-foreground">
            {unit}
          </small>
        )}
      </div>
      {note && (
        <div className="truncate text-[11px] text-muted-foreground">{note}</div>
      )}
    </div>
  );
}

const asMetric = (option: string | undefined, fallback: StatsMetric) =>
  (option ?? fallback) as StatsMetric;

// Year to date --------------------------------------------------------------

function yearSeries(
  context: TileContext,
  year: number,
  metric: StatsMetric,
): LineSeries {
  const currentYear = dateOfDay(context.today).getUTCFullYear();
  const first = yearStart(year);
  const last = year === currentYear ? context.today : yearStart(year + 1) - 1;
  const totals = cumulativeByDay(context.activities, metric, first, last);
  return {
    key: String(year),
    label: String(year),
    points: totals.map((y, x) => ({ x, y })),
    current: year === currentYear,
  };
}

const dayOfYearLabel = (x: number) =>
  shortDate(dateOfDay(yearStart(2001) + Math.round(x)));

const yearToDateView: TileView = {
  period: ({ today }) => {
    const year = dateOfDay(today).getUTCFullYear();
    return `${year} vs ${year - 1}`;
  },
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const { current, previous } = yearToDate(activities, today, metric);
    return {
      value: formatMetric(current, metric),
      unit: metricUnit[metric],
      sub: (
        <Delta
          current={current}
          previous={previous}
          metric={metric}
          text={`vs ${dateOfDay(today).getUTCFullYear() - 1} by ${shortDate(dateOfDay(today))}`}
        />
      ),
    };
  },
  faceOptions: metricFaceOptions,
  face: (context, option) => {
    const metric = asMetric(option, 'distance');
    const year = dateOfDay(context.today).getUTCFullYear();
    return (
      <FillChart>
        {({ width, height }) => (
          <CumulativeLines
            series={[
              yearSeries(context, year - 1, metric),
              yearSeries(context, year, metric),
            ]}
            xMax={365}
            width={width}
            height={height}
            palette={context.palette}
            detail={false}
            endLabels
            valueFormat={(y) => formatWithUnit(y, metric)}
            xLabel={dayOfYearLabel}
          />
        )}
      </FillChart>
    );
  },
  detail: (context, option) => {
    const metric = asMetric(option, 'distance');
    const year = dateOfDay(context.today).getUTCFullYear();
    const firstYear = Math.max(
      year - 4,
      Math.min(
        year,
        ...context.activities.map((a) => a.start_date_local.getUTCFullYear()),
      ),
    );
    const series = Array.from({ length: year - firstYear + 1 }, (_, index) =>
      yearSeries(context, firstYear + index, metric),
    );
    return (
      <>
        <DetailChart height={300}>
          {({ width, height }) => (
            <CumulativeLines
              series={series}
              xMax={365}
              width={width}
              height={height}
              palette={context.palette}
              detail
              monthAxisFrom={yearStart(2001)}
              valueFormat={(y) => formatWithUnit(y, metric)}
              xLabel={dayOfYearLabel}
            />
          )}
        </DetailChart>
        <p className="text-xs text-muted-foreground">
          The dark line is {year}. Grey lines are the years before it, older
          ones lighter.
        </p>
      </>
    );
  },
};

// Weekly volume -------------------------------------------------------------

const weekOf = (x: string) => `Week of ${shortDate(dateOfDay(Number(x)))}`;

function weekRows(context: TileContext, metric: StatsMetric) {
  return weeklyVolumeBySport(context.activities, context.today, metric).flatMap(
    ({ weekStart, bySport }) =>
      Object.entries(bySport).map(([sport, value]) => ({
        x: String(weekStart),
        sport: sport as keyof typeof bySport,
        value,
      })),
  );
}

// Total of `metric` over the `days` days ending on `last`.
const sumOver = (
  context: TileContext,
  metric: StatsMetric,
  last: number,
  days: number,
) =>
  cumulativeByDay(context.activities, metric, last - days + 1, last).at(-1) ??
  0;

// Mean of each full week and the three full weeks before it; the current,
// partial week gets no point.
function rollingFourWeeks(context: TileContext, metric: StatsMetric) {
  const { weekStarts, values } = weeklyVolume(
    context.activities,
    context.today,
    metric,
  );
  return weekStarts.flatMap((weekStart, index) =>
    index >= 3 && index < values.length - 1
      ? [
          {
            x: String(weekStart),
            value:
              values.slice(index - 3, index + 1).reduce((a, b) => a + b, 0) / 4,
          },
        ]
      : [],
  );
}

const weeklyVolumeView: TileView = {
  period: () => 'Last 4 weeks',
  summary: (context, option) => {
    const metric = asMetric(option, 'distance');
    const current = sumOver(context, metric, context.today, 28);
    const previous = sumOver(context, metric, context.today - 28, 28);
    return {
      value: formatMetric(current, metric),
      unit: `${metricUnit[metric]} · last 4 weeks`,
      sub: (
        <Delta
          current={current}
          previous={previous}
          metric={metric}
          text="vs the 4 weeks before"
        />
      ),
    };
  },
  faceOptions: metricFaceOptions,
  face: (context, option) => {
    const metric = asMetric(option, 'distance');
    const { weekStarts, values } = weeklyVolume(
      context.activities,
      context.today,
      metric,
    );
    return (
      <>
        <FillChart>
          {({ width, height }) => (
            <VolumeArea
              weeks={weekStarts.map((weekStart, index) => ({
                x: dateOfDay(weekStart),
                value: values[index]!,
              }))}
              trend={rollingFourWeeks(context, metric).map((point) => ({
                x: dateOfDay(Number(point.x)),
                value: point.value,
              }))}
              trendLabel="4-wk avg"
              width={width}
              height={height}
              palette={context.palette}
              valueFormat={(value) => formatWithUnit(value, metric)}
            />
          )}
        </FillChart>
      </>
    );
  },
  detail: (context, option) => {
    const metric = asMetric(option, 'distance');
    const rows = weekRows(context, metric);
    const { values } = weeklyVolume(context.activities, context.today, metric);
    const fullWeeks = values.slice(0, -1);
    const average =
      fullWeeks.reduce((sum, value) => sum + value, 0) / fullWeeks.length;
    const sports = Object.keys(categorySettings).filter((sport) =>
      rows.some((row) => row.sport === sport && row.value > 0),
    );
    return (
      <>
        <DetailChart height={260}>
          {({ width, height }) => (
            <SportBars
              rows={rows}
              width={width}
              height={height}
              detail
              average={average}
              palette={context.palette}
              valueFormat={(value) => formatWithUnit(value, metric)}
              xTickFormat={(x) => shortDate(dateOfDay(Number(x)))}
            />
          )}
        </DetailChart>
        <Legend sports={sports} />
        <p className="text-xs text-muted-foreground">
          The dashed line is the average of the 11 full weeks. The last bar is
          this week so far.
        </p>
      </>
    );
  },
};

// Activity calendar ---------------------------------------------------------

function lastYearStart(today: number) {
  const date = dateOfDay(today);
  const year = date.getUTCFullYear() - 1;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return monthStart(year, month) + Math.min(date.getUTCDate(), lastDay) - 1;
}

const activityCalendarView: TileView = {
  period: () => 'Last 12 months',
  summary: ({ activities, today }) => {
    const { activeDays } = activityCalendar(activities, today);
    const days = today - lastYearStart(today) + 1;
    return {
      value: String(activeDays),
      unit: 'active days',
      sub: `${Math.round((activeDays / days) * 100)}% of days in the last 12 months`,
    };
  },
  face: (context) => {
    const { dominantSport } = activityCalendar(
      context.activities,
      context.today,
    );
    const days = dailyTotals(
      context.activities,
      lastYearStart(context.today),
      context.today,
    );
    // Sports by how many days they coloured, for the legend.
    const dayCounts = new Map<Sport, number>();
    for (const sport of dominantSport.values())
      dayCounts.set(sport, (dayCounts.get(sport) ?? 0) + 1);
    const sports = [...dayCounts.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([sport]) => sport);
    return (
      <MonthRows
        today={context.today}
        dominantSport={dominantSport}
        totals={days}
        palette={context.palette}
        footer={<SportLegend sports={sports} />}
      />
    );
  },
  detail: (context, option) => {
    const colour = (option ?? 'sport') as CalendarColour;
    const { dominantSport } = activityCalendar(
      context.activities,
      context.today,
    );
    const days = dailyTotals(
      context.activities,
      lastYearStart(context.today),
      context.today,
    );
    const sports = Object.keys(categorySettings).filter((sport) =>
      [...dominantSport.values()].includes(sport as never),
    );
    return (
      <>
        <div className="overflow-x-auto">
          <DetailChart height={150}>
            {({ width, height }) => (
              <CalendarHeatmap
                today={context.today}
                weeks={53}
                width={Math.max(width, 480)}
                height={height}
                dominantSport={dominantSport}
                totals={days}
                colour={colour}
                palette={context.palette}
                labels
              />
            )}
          </DetailChart>
        </div>
        {colour === 'sport' ? (
          <Legend sports={sports} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Darker means more {metricLabel[colour].toLowerCase()} that day.
          </p>
        )}
      </>
    );
  },
};

// This month vs last month --------------------------------------------------

function monthPair(context: TileContext, metric: StatsMetric): LineSeries[] {
  const date = dateOfDay(context.today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const previousStart = monthStart(year, month - 1);
  const thisStart = monthStart(year, month);
  const toPoints = (values: number[]) => [
    { x: 0, y: 0 },
    ...values.map((y, index) => ({ x: index + 1, y })),
  ];
  return [
    {
      key: 'previous',
      label: monthName(dateOfDay(previousStart)),
      points: toPoints(
        cumulativeByDay(
          context.activities,
          metric,
          previousStart,
          thisStart - 1,
        ),
      ),
      current: false,
    },
    {
      key: 'current',
      label: monthName(date),
      points: toPoints(
        cumulativeByDay(context.activities, metric, thisStart, context.today),
      ),
      current: true,
    },
  ];
}

// "Aug 1–26": last month up to today's day number, capped at its last day.
function samePeriodLastMonth(today: number) {
  const date = dateOfDay(today);
  const previous = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1),
  );
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0),
  ).getUTCDate();
  return `${monthName(previous)} 1–${Math.min(date.getUTCDate(), lastDay)}`;
}

const monthVsLastMonthView: TileView = {
  period: ({ today }) => {
    const date = dateOfDay(today);
    const previous = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1),
    );
    return `${monthName(date)} vs ${monthName(previous)}`;
  },
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'elevation');
    const { current, previous } = monthVsLastMonth(activities, today, metric);
    return {
      value: formatMetric(current, metric),
      unit: metricUnit[metric],
      sub: (
        <Delta
          current={current}
          previous={previous}
          metric={metric}
          text={`vs ${samePeriodLastMonth(today)}`}
        />
      ),
    };
  },
  faceOptions: metricFaceOptions,
  face: (context, option) => {
    const metric = asMetric(option, 'elevation');
    return (
      <FillChart>
        {({ width, height }) => (
          <CumulativeLines
            series={monthPair(context, metric)}
            xMax={31}
            width={width}
            height={height}
            palette={context.palette}
            detail={false}
            valueFormat={(y) => formatWithUnit(y, metric)}
            xLabel={(x) => `Day ${x}`}
          />
        )}
      </FillChart>
    );
  },
  detail: (context, option) => {
    const metric = asMetric(option, 'elevation');
    return (
      <DetailChart height={260}>
        {({ width, height }) => (
          <CumulativeLines
            series={monthPair(context, metric)}
            xMax={31}
            width={width}
            height={height}
            palette={context.palette}
            detail
            valueFormat={(y) => formatWithUnit(y, metric)}
            xLabel={(x) => `Day ${x}`}
          />
        )}
      </DetailChart>
    );
  },
};

// Sport mix -----------------------------------------------------------------

type MixRange = 'currentYear' | 'allTime';

const sportMixView: TileView = {
  period: ({ today }) => `${dateOfDay(today).getUTCFullYear()} by time`,
  summary: ({ activities, today }, option) => {
    const range = (option ?? 'currentYear') as MixRange;
    const [top] = sportMix(activities, today, range);
    if (!top) return { value: '–', unit: '', sub: 'No moving time yet' };
    const hours = activities.length
      ? sportBreakdown(
          activities,
          range === 'allTime'
            ? -Infinity
            : yearStart(dateOfDay(today).getUTCFullYear()),
          today,
        ).reduce((sum, row) => sum + row.time, 0)
      : 0;
    return {
      value: `${Math.round(top.share * 100)}%`,
      unit: categorySettings[top.sport].name,
      sub: `of ${formatWithUnit(hours, 'time')} moving time`,
    };
  },
  face: ({ activities, today }) => {
    const shares = sportMix(activities, today, 'currentYear');
    return (
      <div className="mt-auto pt-2">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-sm">
          {shares.map(({ sport, share }) => (
            <i
              key={sport}
              className="block h-full"
              style={{ flex: share, background: categorySettings[sport].color }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex h-4 flex-wrap gap-x-2.5 overflow-hidden text-[11px] leading-4 text-muted-foreground">
          {shares.slice(0, 3).map(({ sport, share }) => (
            <span key={sport} className="flex items-center gap-1">
              <i
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: categorySettings[sport].color }}
              />
              {categorySettings[sport].name} {Math.round(share * 100)}%
            </span>
          ))}
        </div>
      </div>
    );
  },
  detail: ({ activities, today }, option) => {
    const range = (option ?? 'currentYear') as MixRange;
    const shares = sportMix(activities, today, range);
    const breakdown = new Map(
      sportBreakdown(
        activities,
        range === 'allTime'
          ? -Infinity
          : yearStart(dateOfDay(today).getUTCFullYear()),
        today,
      ).map((row) => [row.sport, row]),
    );
    const largest = shares[0]?.share ?? 1;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 text-left font-medium">Sport</th>
              <th className="w-1/3" />
              {['Share', 'Acts', 'km', 'm', 'h'].map((label) => (
                <th key={label} className="px-2 py-1.5 text-right font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {shares.map(({ sport, share }) => {
              const row = breakdown.get(sport);
              return (
                <tr key={sport} className="border-b border-muted">
                  <td className="whitespace-nowrap py-1.5 pr-2 font-sans">
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full"
                      style={{ background: categorySettings[sport].color }}
                    />
                    {categorySettings[sport].name}
                  </td>
                  <td>
                    <div
                      className="h-2 rounded-sm"
                      style={{
                        width: `${(share / largest) * 100}%`,
                        background: categorySettings[sport].color,
                      }}
                    />
                  </td>
                  <td className="px-2 text-right">
                    {Math.round(share * 100)}%
                  </td>
                  <td className="px-2 text-right">{row?.count ?? 0}</td>
                  <td className="px-2 text-right">
                    {formatMetric(row?.distance ?? 0, 'distance')}
                  </td>
                  <td className="px-2 text-right">
                    {formatMetric(row?.elevation ?? 0, 'elevation')}
                  </td>
                  <td className="px-2 text-right">
                    {formatMetric(row?.time ?? 0, 'time')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  },
};

// Consistency ---------------------------------------------------------------

const weeksOf = (option: string | undefined) =>
  option === 'last52Weeks' ? 52 : 12;

const consistencyView: TileView = {
  period: () => 'Last 12 weeks',
  summary: (context, option) => {
    const result = consistency(
      context.activities,
      context.today,
      weeksOf(option),
    );
    const fullWeeks = activeDaysPerWeek(
      context.activities,
      context.today,
      weeksOf(option),
    ).slice(0, -1);
    const solid = fullWeeks.filter((week) => week.activeDays >= 5).length;
    return {
      value: result.activeDaysPerWeek.toFixed(1),
      unit: 'days / week',
      sub: `5+ active days in ${solid} of ${fullWeeks.length} weeks`,
    };
  },
  // One column per week (Monday on top), one dot per day: filled when
  // active, hollow when not.
  face: (context) => {
    const first = mondayOf(context.today) - 11 * 7;
    const flags = activeDayFlags(
      context.activities,
      context.today,
      context.today - first + 1,
    );
    return (
      <div
        className="mt-auto grid grid-flow-col gap-[3px]"
        style={{
          gridTemplateRows: 'repeat(7, minmax(0, 1fr))',
          gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
        }}
        role="img"
        aria-label="Active days, last 12 weeks"
      >
        {Array.from({ length: 12 * 7 }, (_, index) => {
          const day = first + index;
          const active = flags[index];
          return (
            <i
              key={index}
              className={cn(
                'mx-auto block h-1.5 w-1.5 rounded-full',
                day > context.today
                  ? 'bg-transparent'
                  : active
                    ? 'bg-foreground'
                    : 'border border-muted-foreground/40',
              )}
              title={
                day > context.today
                  ? undefined
                  : `${shortDate(dateOfDay(day))}: ${active ? 'active' : 'rest day'}`
              }
            />
          );
        })}
      </div>
    );
  },
  detail: (context, option) => {
    const weeks = weeksOf(option);
    const { activeDaysPerWeek: average } = consistency(
      context.activities,
      context.today,
      weeks,
    );
    return (
      <>
        <DetailChart height={220}>
          {({ width, height }) => (
            <PlainBars
              rows={activeDaysPerWeek(
                context.activities,
                context.today,
                weeks,
              ).map((week, index, all) => ({
                x: String(week.weekStart),
                value: week.activeDays,
                highlight: index === all.length - 1,
              }))}
              width={width}
              height={height}
              detail
              average={average}
              palette={context.palette}
              valueFormat={(value) => `${value} active days`}
              xTickFormat={(x) => shortDate(dateOfDay(Number(x)))}
            />
          )}
        </DetailChart>
        <p className="text-xs text-muted-foreground">
          Active days per week. The dark bar is this week so far; the dashed
          line is the average over the full weeks.
        </p>
      </>
    );
  },
};

// Distance vs elevation -----------------------------------------------------

// Climbing is a trend: how hilly the last 12 months were, month by month,
// against the 12 months before.
const distanceVsElevationView: TileView = {
  period: () => 'Last 12 months',
  summary: ({ activities, today }) => {
    const oneYearAgo = lastYearStart(today);
    const current = climbRate(activities, oneYearAgo, today);
    const previous = climbRate(
      activities,
      lastYearStart(oneYearAgo - 1),
      oneYearAgo - 1,
    );
    return {
      value: formatMetric(current, 'elevation'),
      unit: 'm climbed per 100 km',
      sub: (
        <Delta
          current={current}
          previous={previous}
          text="vs the 12 months before"
        />
      ),
    };
  },
  face: (context) => {
    const months = climbRateByMonth(context.activities, context.today);
    return (
      <>
        <FillChart>
          {({ width, height }) => (
            <PlainBars
              rows={months.map((month, index) => ({
                x: String(month.monthStart),
                value: month.rate,
                highlight: index === months.length - 1,
              }))}
              width={width}
              height={height}
              detail={false}
              palette={context.palette}
              xTickFormat={(x) => {
                const date = dateOfDay(Number(x));
                return `${monthName(date)} ${date.getUTCFullYear()}`;
              }}
              valueFormat={(value) =>
                `${formatMetric(value, 'elevation')} m per 100 km`
              }
            />
          )}
        </FillChart>
        <div className="mt-1 grid shrink-0 grid-cols-12 text-center text-[10px] text-muted-foreground">
          {months.map((month) => (
            <span key={month.monthStart}>
              {monthName(dateOfDay(month.monthStart)).slice(0, 1)}
            </span>
          ))}
        </div>
      </>
    );
  },
  detail: ({ activities, today }) => {
    const { points } = distanceVsElevation(activities, today);
    const sports = Object.keys(categorySettings).filter((sport) =>
      points.some((point) => point.sport === sport),
    );
    return (
      <>
        <DetailChart height={320}>
          {({ width, height }) => (
            <DistanceElevationDots
              points={points}
              width={width}
              height={height}
              detail
            />
          )}
        </DetailChart>
        <Legend sports={sports} />
        <p className="text-xs text-muted-foreground">
          Distance in km across, elevation gain in m up.
        </p>
      </>
    );
  },
};

// This week ------------------------------------------------------------------

const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const thisWeekView: TileView = {
  period: () => 'This week',
  // Compared with a typical week up to the same weekday, so an early-week
  // total is not held against a full week.
  summary: (context, option) => {
    const metric = asMetric(option, 'distance');
    const days = thisWeekByDay(context.activities, context.today, metric);
    const weekday = weekdayNames[days.filter((day) => day !== null).length - 1];
    return {
      value: formatMetric(
        days.reduce<number>((sum, day) => sum + (day ?? 0), 0),
        metric,
      ),
      unit: `${metricUnit[metric]} so far`,
      sub: (
        <Delta
          current={days.reduce<number>((sum, day) => sum + (day ?? 0), 0)}
          previous={typicalThroughWeekday(
            context.activities,
            context.today,
            metric,
          )}
          metric={metric}
          text={`vs typical by ${weekday}`}
        />
      ),
    };
  },
  faceOptions: metricFaceOptions,
  face: (context, option) => {
    const metric = asMetric(option, 'distance');
    const days = thisWeekByDay(context.activities, context.today, metric);
    const todayIndex = days.filter((day) => day !== null).length - 1;
    return (
      <>
        <FillChart>
          {({ width, height }) => (
            <PlainBars
              rows={days.map((value, index) => ({
                x: weekdayNames[index]!,
                value: value ?? 0,
                highlight: index === todayIndex,
              }))}
              width={width}
              height={height}
              detail={false}
              palette={context.palette}
              valueFormat={(value) => formatWithUnit(value, metric)}
            />
          )}
        </FillChart>
        <div className="mt-1 grid shrink-0 grid-cols-7 text-center text-[10px] text-muted-foreground">
          {weekdayNames.map((name, index) => (
            <span
              key={name}
              className={cn(
                index === todayIndex && 'font-medium text-foreground',
              )}
            >
              {name.slice(0, 1)}
            </span>
          ))}
        </div>
      </>
    );
  },
};

// Typical week ---------------------------------------------------------------

const decimal = (value: number) => value.toFixed(1);

const typicalWeekView: TileView = {
  period: () => 'Last 11 full weeks',
  summary: ({ activities, today }) => {
    const week = typicalWeek(activities, today);
    return {
      value: formatMetric(week.time, 'time'),
      unit: 'h / week',
      sub: `${decimal(week.activeDays)} active days a week`,
    };
  },
  face: ({ activities, today }) => {
    const week = typicalWeek(activities, today);
    return (
      <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-2">
        <Stat
          label="Distance"
          value={formatMetric(week.distance, 'distance')}
          unit="km"
        />
        <Stat
          label="Elevation"
          value={formatMetric(week.elevation, 'elevation')}
          unit="m"
        />
        <Stat label="Activities" value={decimal(week.count)} />
      </div>
    );
  },
};

// Pace -----------------------------------------------------------------------

const paceUnit: Record<StatsMetric, string> = {
  count: 'activities / day',
  distance: 'km / day',
  elevation: 'm / day',
  time: 'h / day',
};

const yearPaceView: TileView = {
  period: ({ today }) => `${dateOfDay(today).getUTCFullYear()} pace`,
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const pace = yearPace(activities, today, metric);
    return {
      value:
        metric === 'elevation'
          ? formatMetric(pace.perDay, metric)
          : decimal(pace.perDay),
      unit: paceUnit[metric],
      sub: 'this year so far, projected to Dec 31',
    };
  },
  faceOptions: metricFaceOptions,
  face: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const pace = yearPace(activities, today, metric);
    const year = dateOfDay(today).getUTCFullYear();
    const unit = metricUnit[metric];
    const scale = Math.max(pace.projected, pace.lastYear, 1);
    const at = (value: number) => `${(value / scale) * 100}%`;
    return (
      <div className="mt-auto pt-2">
        <div className="relative h-2.5 rounded-sm bg-muted">
          <div
            className="absolute inset-y-0 left-0 rounded-sm bg-foreground/25"
            style={{ width: at(pace.projected) }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-sm bg-foreground"
            style={{ width: at(pace.current) }}
          />
          {pace.lastYear > 0 && (
            <div
              className="absolute -inset-y-1 w-0.5 bg-orange-600 dark:bg-orange-400"
              style={{ left: at(pace.lastYear) }}
            />
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat
            label={<LegendLabel swatch="bg-foreground">So far</LegendLabel>}
            value={formatMetric(pace.current, metric)}
            unit={unit}
          />
          <Stat
            label={
              <LegendLabel swatch="bg-foreground/25">Projected</LegendLabel>
            }
            value={formatMetric(pace.projected, metric)}
            unit={unit}
          />
          <Stat
            label={
              <LegendLabel swatch="w-0.5 bg-orange-600 dark:bg-orange-400">
                {String(year - 1)}
              </LegendLabel>
            }
            value={
              pace.lastYear > 0 ? formatMetric(pace.lastYear, metric) : '–'
            }
            unit={pace.lastYear > 0 ? unit : undefined}
          />
        </div>
      </div>
    );
  },
};

// Records --------------------------------------------------------------------

const recordsView: TileView = {
  period: ({ today }) => String(dateOfDay(today).getUTCFullYear()),
  // No headline: the records sit side by side so none competes with the
  // year's total.
  summary: () => null,
  face: ({ activities, today }) => {
    const best = records(
      activities,
      yearStart(dateOfDay(today).getUTCFullYear()),
      today,
    );
    const noteFor = (record: { day: number; sport: Sport } | undefined) =>
      record
        ? `${categorySettings[record.sport].name}, ${shortDate(dateOfDay(record.day))}`
        : undefined;
    return (
      <div className="my-auto grid grid-cols-4 gap-3">
        <Stat
          large
          label="Longest distance"
          value={
            best.distance ? formatMetric(best.distance.value, 'distance') : '–'
          }
          unit={best.distance ? 'km' : undefined}
          note={noteFor(best.distance)}
        />
        <Stat
          large
          label="Longest time"
          value={best.time ? formatMetric(best.time.value, 'time') : '–'}
          unit={best.time ? 'h' : undefined}
          note={noteFor(best.time)}
        />
        <Stat
          large
          label="Biggest climb"
          value={
            best.elevation
              ? formatMetric(best.elevation.value, 'elevation')
              : '–'
          }
          unit={best.elevation ? 'm' : undefined}
          note={noteFor(best.elevation)}
        />
        <Stat
          large
          label="Biggest week"
          value={
            best.biggestWeek
              ? formatMetric(best.biggestWeek.value, 'distance')
              : '–'
          }
          unit={best.biggestWeek ? 'km' : undefined}
          note={
            best.biggestWeek
              ? weekOf(String(best.biggestWeek.weekStart))
              : undefined
          }
        />
      </div>
    );
  },
};

// Best 30 days ---------------------------------------------------------------

const best30DaysView: TileView = {
  period: ({ today }) => String(dateOfDay(today).getUTCFullYear()),
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const best = bestWindow(
      activities,
      yearStart(dateOfDay(today).getUTCFullYear()),
      today,
      metric,
    );
    if (best.total === 0)
      return { value: '–', unit: '', sub: 'No activities this year yet' };
    return {
      value: formatMetric(best.total, metric),
      unit: metricUnit[metric],
      sub: `${shortDate(dateOfDay(best.start))} – ${shortDate(dateOfDay(best.end))}`,
    };
  },
  faceOptions: metricFaceOptions,
  face: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const best = bestWindow(
      activities,
      yearStart(dateOfDay(today).getUTCFullYear()),
      today,
      metric,
    );
    const share = best.total > 0 ? best.current / best.total : 0;
    return (
      <div className="mt-auto">
        <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">
            Last 30 days {formatWithUnit(best.current, metric)}
          </span>
          <span className="font-mono tabular-nums">
            {Math.round(share * 100)}%
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-sm bg-muted">
          <div
            className="h-full rounded-sm bg-foreground"
            style={{ width: `${Math.min(1, share) * 100}%` }}
          />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          of the best 30 days
        </div>
      </div>
    );
  },
};

// Rest days ------------------------------------------------------------------

const restDaysView: TileView = {
  period: () => 'Last 90 days',
  summary: ({ activities, today }) => {
    const flags = activeDayFlags(activities, today, 90);
    const rest = (days: boolean[]) => days.filter((active) => !active).length;
    return {
      value: String(rest(flags.slice(-30))),
      unit: 'in 30 days',
      sub: `${rest(flags)} in the last 90 days`,
    };
  },
  face: ({ activities, today }) => {
    const flags = activeDayFlags(activities, today, 90);
    return (
      <div className="mt-auto">
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}
          role="img"
          aria-label="Rest days in the last 90 days"
        >
          {flags.map((active, index) => (
            <i
              key={index}
              className={cn(
                'block aspect-square rounded-[1px]',
                active
                  ? 'bg-muted-foreground/25'
                  : 'bg-orange-600 dark:bg-orange-400',
              )}
              title={`${shortDate(dateOfDay(today - 89 + index))}: ${
                active ? 'active' : 'rest day'
              }`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>90 days ago</span>
          <span>today</span>
        </div>
      </div>
    );
  },
};

// Speed trend is optional in the manifest and has no rules or fixtures yet,
// so no platform draws it. Totals is folded into Year to date and Pace.
export function tileView(id: StatsTileID): TileView | null {
  switch (id) {
    case 'thisWeek':
      return thisWeekView;
    case 'typicalWeek':
      return typicalWeekView;
    case 'yearPace':
      return yearPaceView;
    case 'records':
      return recordsView;
    case 'best30Days':
      return best30DaysView;
    case 'restDays':
      return restDaysView;
    case 'yearToDate':
      return yearToDateView;
    case 'totals':
      return null;
    case 'weeklyVolume':
      return weeklyVolumeView;
    case 'activityCalendar':
      return activityCalendarView;
    case 'monthVsLastMonth':
      return monthVsLastMonthView;
    case 'sportMix':
      return sportMixView;
    case 'consistency':
      return consistencyView;
    case 'distanceVsElevation':
      return distanceVsElevationView;
    case 'speedTrend':
      return null;
  }
}
