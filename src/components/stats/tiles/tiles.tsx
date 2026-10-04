'use client';

// What each tile shows on its face and in its detail view. The switch over
// StatsTileID is exhaustive, so a tile added to shared/stats-tiles.json
// fails the build here until it has a view.

import { useMemo, useState, type ReactNode } from 'react';
import { comparisonBand } from '~/lib/stats/comparison-band';
import { volumeHistoryAverage } from '~/lib/stats/history';

import { categorySettings } from '~/settings/category';
import {
  type StatsMetric,
  type StatsTileID,
} from '~/settings/stats-tiles.generated';
import {
  best30Days,
  sameDateLastYear,
  climbing,
  dayOf,
  fourWeekVolume,
  mondayOf,
  monthVsLastMonth,
  records,
  sportMix,
  thisWeek,
  typicalWeek,
  weeklyVolume,
  yearPace,
  yearToDate,
  type ActivityRecord,
  type StatsActivity,
} from '~/lib/stats/tile-data';
import {
  cumulativeByDay,
  cumulativeYearPoints,
  comparisonYear,
  dateOfDay,
  monthStart,
  sportBreakdown,
  yearStart,
} from '~/lib/stats/tile-series';
import { cn } from '~/lib/utils';

import { VolumeHistory, CalendarHistory } from './history';
import {
  CumulativeLines,
  Measure,
  PlainBars,
  VolumeArea,
  type LineSeries,
} from './charts';
import {
  formatMetric,
  formatHilliness,
  formatDailyRate,
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
  filtered?: boolean;
  singleSport?: boolean;
  onOpenActivity?: (id: number) => void;
  onExpand?: () => void;
  palette: TilePalette;
};

export type TileSummary = { value: string; unit: string; sub: ReactNode };

export type TileView = {
  // Expansion must offer useful details, controls, or a more inspectable chart.
  expandable: boolean;
  period: (context: TileContext, option?: string) => string;
  // The period line while expanded, when it differs from the face's.
  expandedPeriod?: string;
  // Null leaves the face without a headline number.
  summary: (
    context: TileContext,
    option: string | undefined,
  ) => TileSummary | null;
  // The tile's visual. Expanded, it is the same visual drawn larger, with
  // axes where it is a chart.
  face: (
    context: TileContext,
    option: string | undefined,
    expanded: boolean,
  ) => ReactNode;
  // Extra context shown below the face only when the tile is expanded.
  more?: (context: TileContext, option: string | undefined) => ReactNode;
  detail?: (context: TileContext, option: string | undefined) => ReactNode;
};

// Short labels for the face switches, which have little room.
export const faceOptionLabels: Record<string, string> = {
  distance: 'km',
  time: 'h',
  elevation: 'm',
  count: '#',
  sport: 'Sport',
  currentYear: 'This year',
  allTime: 'All time',
  last12Weeks: '12 weeks',
  last52Weeks: '52 weeks',
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
// metric is given) and the percentage. Increases are green; a decrease is
// not a failure, so it keeps the neutral text colour.
function Delta({
  current,
  previous,
  text,
  metric,
  neutral = false,
}: {
  current: number;
  previous: number;
  text: string;
  metric?: StatsMetric;
  neutral?: boolean;
}) {
  const change = percentChange(current, previous);
  if (change === null) return <>{text}</>;
  return (
    <>
      <span
        className={cn(
          !neutral && current > previous
            ? 'text-green-700 dark:text-green-400'
            : 'text-foreground',
        )}
      >
        {metric &&
          `${signed(current - previous, (value) => formatWithUnit(value, metric))} · `}
        {change === 0 && current !== previous
          ? `${current > previous ? '+' : '−'}<1`
          : signed(change, String)}
        %
      </span>{' '}
      {text}
    </>
  );
}

// A chart filling the rest of a collapsed tile, or a fixed, taller area
// in an expanded one (whose height follows its content).
function FillChart({
  expanded = false,
  pilot = false,
  overviewHeight = 110,
  children,
}: {
  expanded?: boolean;
  pilot?: boolean;
  overviewHeight?: number;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  return expanded ? (
    <Measure className="mt-4 w-full" style={{ height: 300 }}>
      {children}
    </Measure>
  ) : pilot ? (
    <Measure
      className="mt-2 w-full shrink-0"
      style={{ height: overviewHeight }}
    >
      {children}
    </Measure>
  ) : (
    <Measure className="mt-2 min-h-0 flex-1">{children}</Measure>
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
  note?: ReactNode;
  large?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
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
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

const weekOf = (x: string) => `Week of ${shortDate(dateOfDay(Number(x)))}`;

const asMetric = (option: string | undefined, fallback: StatsMetric) =>
  (option ?? fallback) as StatsMetric;

// Year to date --------------------------------------------------------------

function yearSeries(
  context: TileContext,
  year: number,
  metric: StatsMetric,
): LineSeries {
  const currentYear = dateOfDay(context.today).getUTCFullYear();
  const last = year === currentYear ? context.today : yearStart(year + 1) - 1;
  const points = cumulativeYearPoints(context.activities, metric, year, last);
  return {
    key: String(year),
    label: String(year),
    points,
    current: year === currentYear,
  };
}

const dayOfYearLabel = (x: number) =>
  shortDate(dateOfDay(yearStart(comparisonYear) + Math.round(x)));

const yearToDateView: TileView = {
  expandable: true,
  period: ({ today }) => {
    const year = dateOfDay(today).getUTCFullYear();
    return `${year} vs ${year - 1}`;
  },
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const { current, previous } = yearToDate(activities, today, metric);
    return {
      value: formatMetric(current, metric),
      unit: `${metric === 'count' ? 'activities' : metricUnit[metric]} so far`,
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
  face: (context, option, expanded) => {
    const metric = asMetric(option, 'distance');
    const year = dateOfDay(context.today).getUTCFullYear();
    const band = comparisonBand(
      context.activities,
      context.today,
      metric,
      'year',
    );
    return (
      <FillChart expanded={expanded} pilot overviewHeight={130}>
        {({ width, height }) => (
          <CumulativeLines
            band={band}
            series={[
              yearSeries(context, year - 1, metric),
              yearSeries(context, year, metric),
            ]}
            monthAxisFrom={yearStart(comparisonYear)}
            xMax={365}
            width={width}
            height={height}
            palette={context.palette}
            detail={expanded}
            compact
            endLabels
            valueFormat={(y) => formatWithUnit(y, metric)}
            xLabel={dayOfYearLabel}
          />
        )}
      </FillChart>
    );
  },
};

// Weekly volume -------------------------------------------------------------

function rollingFourWeeks(context: TileContext, metric: StatsMetric) {
  return volumeHistoryAverage(
    context.activities,
    context.today,
    metric,
    'weeks',
  );
}

const weeklyVolumeView: TileView = {
  expandable: true,
  detail: (context, option) => (
    <VolumeHistory context={context} metric={asMetric(option, 'distance')} />
  ),
  period: () => '12-week trend',
  expandedPeriod: 'Volume by sport',
  summary: (context, option) => {
    const metric = asMetric(option, 'distance');
    const { current, previous } = fourWeekVolume(
      context.activities,
      context.today,
      metric,
    );
    return {
      value: formatMetric(current, metric),
      unit: `${metricUnit[metric]} · last 28 days`,
      sub: (
        <Delta
          current={current}
          previous={previous}
          metric={metric}
          text="vs previous 28 days"
        />
      ),
    };
  },
  face: (context, option, expanded) => {
    const metric = asMetric(option, 'distance');
    const { weekStarts, values } = weeklyVolume(
      context.activities,
      context.today,
      metric,
    );
    return (
      <>
        <FillChart expanded={expanded} pilot>
          {({ width, height }) => (
            <VolumeArea
              detail={expanded}
              compact={!expanded}
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
};

// Activity calendar ---------------------------------------------------------

const activityCalendarView: TileView = {
  expandable: true,
  period: () => 'Last 12 months',
  // The period navigation names the range; label the colour switch instead.
  expandedPeriod: 'Colour by',
  summary: () => null,
  face: (context, option, expanded) => (
    <CalendarHistory
      context={context}
      colorBy={(option ?? 'sport') as 'sport' | StatsMetric}
      expanded={expanded}
    />
  ),
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
  expandable: true,
  period: ({ today }) => {
    const date = dateOfDay(today);
    const previous = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1),
    );
    return `${monthName(date)} vs ${monthName(previous)}`;
  },
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const { current, previous } = monthVsLastMonth(activities, today, metric);
    return {
      value: formatMetric(current, metric),
      unit: `${metric === 'count' ? 'activities' : metricUnit[metric]} so far`,
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
  face: (context, option, expanded) => {
    const metric = asMetric(option, 'distance');
    const band = comparisonBand(
      context.activities,
      context.today,
      metric,
      'month',
    );
    return (
      <FillChart expanded={expanded} pilot overviewHeight={130}>
        {({ width, height }) => (
          <CumulativeLines
            band={band}
            series={monthPair(context, metric)}
            endLabels
            xMax={31}
            width={width}
            height={height}
            palette={context.palette}
            detail={expanded}
            compact
            valueFormat={(y) => formatWithUnit(y, metric)}
            xLabel={(x) => `Day ${x}`}
          />
        )}
      </FillChart>
    );
  },
};

// Sport mix -----------------------------------------------------------------

type MixRange = 'currentYear' | 'allTime';

const sportMixView: TileView = {
  expandable: true,
  period: ({ today }, option) =>
    option === 'allTime'
      ? 'All time by moving time'
      : `${dateOfDay(today).getUTCFullYear()} by moving time`,
  summary: ({ activities, today, singleSport }, option) => {
    const range = (option ?? 'currentYear') as MixRange;
    const shares = sportMix(activities, today, range);
    const [top] = shares;
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
      sub:
        singleSport || shares.length === 1
          ? 'One sport represented; no mix to compare'
          : `of ${formatWithUnit(hours, 'time')} moving time`,
    };
  },
  face: ({ activities, today }, option, expanded) => {
    const shares = sportMix(
      activities,
      today,
      (option ?? 'currentYear') as MixRange,
    );
    return (
      <div className="mt-auto pt-2">
        <div
          className="flex h-2.5 gap-0.5 overflow-hidden rounded-sm"
          role="img"
          aria-label={shares
            .map(
              ({ sport, share }) =>
                `${categorySettings[sport].name} ${Math.round(share * 100)}%`,
            )
            .join(', ')}
        >
          {shares.map(({ sport, share }) => (
            <i
              key={sport}
              className="block h-full"
              style={{ flex: share, background: categorySettings[sport].color }}
            />
          ))}
        </div>
        {!expanded && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-4 text-muted-foreground">
            {shares.map(({ sport, share }) => (
              <span key={sport} className="flex items-center gap-1">
                <i
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: categorySettings[sport].color }}
                />
                {categorySettings[sport].name} {Math.round(share * 100)}%
              </span>
            ))}
          </div>
        )}
      </div>
    );
  },
  more: ({ activities, today }, option) => {
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
    return (
      <div className="mt-4">
        <ul className="divide-y divide-muted @min-[600px]:hidden">
          {shares.map(({ sport, share }) => {
            const row = breakdown.get(sport);
            return (
              <li key={sport} className="py-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <i
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: categorySettings[sport].color }}
                    />
                    {categorySettings[sport].name}
                  </span>
                  <span>{Math.round(share * 100)}%</span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {[
                    ['Moving time', formatWithUnit(row?.time ?? 0, 'time')],
                    ['Activities', String(row?.count ?? 0)],
                    [
                      'Distance',
                      formatWithUnit(row?.distance ?? 0, 'distance'),
                    ],
                    ['Climb', formatWithUnit(row?.elevation ?? 0, 'elevation')],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex flex-wrap justify-between gap-x-2"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
        <table className="hidden w-full text-sm @min-[600px]:table">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 text-left font-medium">Sport</th>
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

// Distance vs elevation -----------------------------------------------------

// Climbing is a trend: how hilly the last 12 months were, month by month,
// against the 12 months before.
const distanceVsElevationView: TileView = {
  expandable: true,
  period: () => 'Last 12 months',
  summary: ({ activities, today }) => {
    const { current, previous } = climbing(activities, today);
    return {
      value: formatHilliness(current / 100),
      unit: 'm / km',
      sub: (
        <Delta
          current={current}
          previous={previous}
          text="vs the 12 months before"
          neutral
        />
      ),
    };
  },
  face: (context, _option, expanded) => {
    const { months } = climbing(context.activities, context.today);
    return (
      <>
        <FillChart expanded={expanded} pilot>
          {({ width, height }) => (
            <PlainBars
              rows={months.map((month, index) => ({
                x: String(month.monthStart),
                value: month.rate / 100,
                highlight: index === months.length - 1,
              }))}
              width={width}
              height={height}
              detail={expanded}
              compact
              ariaLabel="Monthly hilliness, metres climbed per kilometre"
              xAxisFormat={(x) => monthName(dateOfDay(Number(x)))}
              palette={context.palette}
              xTickFormat={(x) => {
                const date = dateOfDay(Number(x));
                return `${monthName(date)} ${date.getUTCFullYear()}`;
              }}
              valueFormat={(value) => `${formatHilliness(value)} m / km`}
            />
          )}
        </FillChart>
      </>
    );
  },
  more: ({ activities, today, onOpenActivity }) => {
    const first = sameDateLastYear(today);
    const hilliest = activities
      .flatMap((activity) => {
        const day = dayOf(activity.start_date_local);
        const km = (activity.distance ?? 0) / 1000;
        if (day < first || day > today || km < 5) return [];
        const climb = activity.total_elevation_gain ?? 0;
        return [
          {
            day,
            sport: activity.sport,
            id: activity.id,
            name: activity.name,
            km,
            climb,
            rate: climb / km,
          },
        ];
      })
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);
    return (
      <div className="mt-5">
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">
          Hilliest activities (5 km or more)
        </h4>
        {hilliest.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No qualifying activities in the last 12 months.
          </p>
        )}
        <ul className="divide-y divide-muted">
          {hilliest.map((activity, index) => {
            const content = (
              <>
                <span className="flex min-w-0 items-start gap-2">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: categorySettings[activity.sport].color,
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">
                      {activity.name ?? categorySettings[activity.sport].name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {shortDate(dateOfDay(activity.day))},{' '}
                      {dateOfDay(activity.day).getUTCFullYear()} ·{' '}
                      {formatWithUnit(activity.km, 'distance')} ·{' '}
                      {formatWithUnit(activity.climb, 'elevation')} climbed
                    </span>
                    <span className="mt-1 block text-xs tabular-nums">
                      {formatHilliness(activity.rate)} m / km
                    </span>
                  </span>
                  {activity.id !== undefined && onOpenActivity && (
                    <span aria-hidden="true" className="text-muted-foreground">
                      ›
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={activity.id ?? index}>
                {activity.id !== undefined && onOpenActivity ? (
                  <button
                    type="button"
                    className="min-h-11 w-full py-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-2"
                    onClick={() => onOpenActivity(activity.id!)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="py-3 text-sm">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  },
};

// This week ------------------------------------------------------------------

const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const thisWeekView: TileView = {
  expandable: false,
  // The title already says "This week"; name its dates instead.
  period: ({ today }) =>
    `${shortDate(dateOfDay(mondayOf(today)))} – ${shortDate(dateOfDay(mondayOf(today) + 6))}`,
  // Compared with a typical week up to the same weekday, so an early-week
  // total is not held against a full week.
  summary: (context, option) => {
    const metric = asMetric(option, 'distance');
    const week = thisWeek(context.activities, context.today, metric);
    const weekday =
      weekdayNames[week.days.filter((day) => day !== null).length - 1];
    return {
      value: formatMetric(week.current, metric),
      unit: `${metricUnit[metric]} so far`,
      sub: (
        <Delta
          current={week.current}
          previous={week.typical}
          metric={metric}
          text={
            weekday === 'Mon'
              ? 'vs a typical Monday'
              : `vs typical Mon–${weekday}`
          }
        />
      ),
    };
  },
  face: (context, option, expanded) => {
    const metric = asMetric(option, 'distance');
    const { days } = thisWeek(context.activities, context.today, metric);
    const todayIndex = days.filter((day) => day !== null).length - 1;
    return (
      <>
        <FillChart expanded={expanded} pilot>
          {({ width, height }) => (
            <PlainBars
              rows={days.map((value, index) => ({
                x: weekdayNames[index]!,
                value,
                highlight: index === todayIndex,
              }))}
              width={width}
              height={height}
              detail
              compact
              ariaLabel="Daily totals, Monday to Sunday; future days have not elapsed"
              palette={context.palette}
              valueFormat={(value) => formatWithUnit(value, metric)}
            />
          )}
        </FillChart>
      </>
    );
  },
};

// Typical week ---------------------------------------------------------------

const decimal = (value: number) => value.toFixed(1);

const typicalWeekView: TileView = {
  expandable: false,
  period: () => 'Average over 11 full weeks',
  summary: ({ activities, today }) => {
    const week = typicalWeek(activities, today);
    return {
      value: decimal(week.time),
      unit: 'h / week',
      sub: `${decimal(week.activeDays)} active days / week`,
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
  expandable: false,
  period: ({ today }) => `${dateOfDay(today).getUTCFullYear()} projection`,
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const pace = yearPace(activities, today, metric);
    return {
      value: formatMetric(pace.projected, metric),
      unit: `${metricUnit[metric]} projected`,
      sub: "At this year's daily average",
    };
  },
  face: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const pace = yearPace(activities, today, metric);
    const year = dateOfDay(today).getUTCFullYear();
    const unit = metricUnit[metric];
    const scale = Math.max(pace.projected, pace.lastYear, 1);
    const at = (value: number) => `${(value / scale) * 100}%`;
    return (
      <div className="mt-auto pt-2">
        <div className="mb-1.5 text-[11px] text-muted-foreground">
          <LegendLabel swatch="bg-foreground/25">Projected</LegendLabel>
        </div>
        <div
          className="relative h-2.5 rounded-sm"
          role="img"
          aria-label={`So far ${formatWithUnit(pace.current, metric)}; projected ${formatWithUnit(pace.projected, metric)}; ${year - 1}: ${formatWithUnit(pace.lastYear, metric)}`}
        >
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
            label="Daily average"
            value={formatDailyRate(pace.perDay)}
            unit={paceUnit[metric]}
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

// The four records side by side, with the sport and date of each.
function RecordStats({
  best,
  detailed = false,
  onOpenActivity,
}: {
  best: ReturnType<typeof records>;
  detailed?: boolean;
  onOpenActivity?: (id: number) => void;
}) {
  const noteFor = (record: ActivityRecord | undefined) => {
    if (!record || !detailed) return undefined;
    const date = `${shortDate(dateOfDay(record.day))}, ${dateOfDay(record.day).getUTCFullYear()}`;
    return (
      <>
        {record.activityId !== undefined && onOpenActivity ? (
          <button
            type="button"
            className="flex min-h-11 items-center text-left underline underline-offset-2"
            onClick={() => onOpenActivity(record.activityId!)}
          >
            {record.name ?? categorySettings[record.sport].name}
          </button>
        ) : (
          <span className="flex min-h-11 items-center">
            {record.name?.trim()
              ? record.name
              : categorySettings[record.sport].name}
          </span>
        )}
        <span className="block">
          {categorySettings[record.sport].name} · {date}
        </span>
      </>
    );
  };
  if (detailed)
    return (
      <div className="grid gap-4 @min-[600px]:grid-cols-2">
        {(['distance', 'time', 'elevation'] as const).map((metric) => (
          <div key={metric}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {
                  {
                    distance: 'Longest distance',
                    time: 'Longest moving time',
                    elevation: 'Biggest climb',
                  }[metric]
                }
              </span>
              <span className="font-mono text-xl font-medium">
                {best[metric]
                  ? formatWithUnit(best[metric].value, metric)
                  : '–'}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {noteFor(best[metric])}
            </div>
          </div>
        ))}
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">Biggest week</span>
            <span className="font-mono text-xl font-medium">
              {best.biggestWeek
                ? formatWithUnit(best.biggestWeek.value, 'distance')
                : '–'}
            </span>
          </div>
          {best.biggestWeek && (
            <p className="mt-1 text-xs text-muted-foreground">
              Week of {shortDate(dateOfDay(best.biggestWeek.weekStart))},{' '}
              {dateOfDay(best.biggestWeek.weekStart).getUTCFullYear()}
            </p>
          )}
        </div>
      </div>
    );
  return (
    <div
      className={
        detailed
          ? 'grid gap-4 @min-[600px]:grid-cols-2'
          : 'grid grid-cols-2 gap-3 @min-[600px]:grid-cols-4'
      }
    >
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
        label="Longest moving time"
        value={best.time ? formatMetric(best.time.value, 'time') : '–'}
        unit={best.time ? 'h' : undefined}
        note={noteFor(best.time)}
      />
      <Stat
        large
        label="Biggest climb"
        value={
          best.elevation ? formatMetric(best.elevation.value, 'elevation') : '–'
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
          detailed && best.biggestWeek
            ? weekOf(String(best.biggestWeek.weekStart))
            : undefined
        }
      />
    </div>
  );
}

function RecordsDetail({ context }: { context: TileContext }) {
  const [range, setRange] = useState<'currentYear' | 'allTime'>('currentYear');
  const best = useMemo(
    () => records(context.activities, context.today, range),
    [context.activities, context.today, range],
  );
  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Records period"
        className="inline-flex rounded-md bg-muted p-0.5"
      >
        {(['currentYear', 'allTime'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={range === value}
            onClick={() => setRange(value)}
            className={cn(
              'min-h-11 rounded-[5px] px-3 text-xs font-medium text-muted-foreground',
              range === value && 'bg-background text-foreground shadow-xs',
            )}
          >
            {optionLabels[value]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {range === 'allTime'
          ? 'All-time records'
          : `Records · ${dateOfDay(context.today).getUTCFullYear()}`}
      </p>
      <RecordStats
        best={best}
        detailed
        onOpenActivity={context.onOpenActivity}
      />
      <Best30DayRecords context={context} />
    </div>
  );
}

const recordsView: TileView = {
  expandable: true,
  period: ({ today }) => String(dateOfDay(today).getUTCFullYear()),
  expandedPeriod: 'Personal bests',
  summary: () => null,
  face: ({ activities, today }) => (
    <div className="my-auto">
      <RecordStats best={records(activities, today, 'currentYear')} />
    </div>
  ),
  detail: (context) => <RecordsDetail context={context} />,
};

function Best30DayRecords({ context }: { context: TileContext }) {
  const { activities, today } = context;
  const year = dateOfDay(today).getUTCFullYear();
  const hasFullWindow = today - yearStart(year) + 1 >= 30;
  const best = useMemo(
    () =>
      (['distance', 'time', 'elevation'] as const).map((metric) => ({
        metric,
        ...best30Days(activities, today, metric),
      })),
    [activities, today],
  );
  return (
    <section className="border-t pt-3" aria-label="Best 30 days">
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">
        Best 30 days · {year}
      </h4>
      {!hasFullWindow ? (
        <p className="text-sm text-muted-foreground">
          The first complete 30-day window this year ends on Jan 30.
        </p>
      ) : (
        <dl className="divide-y">
          {best.map(({ metric, total, start, end, current }) => (
            <div key={metric} className="py-3 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt>{metricLabel[metric]}</dt>
                <dd className="font-mono font-medium">
                  {total > 0 ? formatWithUnit(total, metric) : '–'}
                </dd>
              </div>
              {total > 0 ? (
                <>
                  <p className="mt-1 text-muted-foreground">
                    {shortDate(dateOfDay(start))} – {shortDate(dateOfDay(end))}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Last 30 days: {formatWithUnit(current, metric)} ·{' '}
                    {Math.round((current / total) * 100)}% of best
                  </p>
                </>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  No {metricLabel[metric].toLowerCase()} recorded this year.
                </p>
              )}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// Speed trend is optional in the manifest and has no rules or fixtures yet,
// so no platform draws it. Totals is folded into Year to date and Pace;
// Consistency and Rest days are not displayed; Typical week retains activity frequency.
// Best 30 days is folded into Records.
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
      return null;
    case 'restDays':
      return null;
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
      return null;
    case 'distanceVsElevation':
      return distanceVsElevationView;
    case 'speedTrend':
      return null;
  }
}
