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
  consistency,
  distanceVsElevation,
  monthVsLastMonth,
  sportMix,
  totals,
  weeklyVolume,
  yearToDate,
  type StatsActivity,
} from '~/lib/stats/tile-data';
import {
  activeDaysPerWeek,
  cumulativeByDay,
  dailyTotals,
  dateOfDay,
  monthStart,
  sportBreakdown,
  totalsByYear,
  weeklyVolumeBySport,
  yearStart,
} from '~/lib/stats/tile-series';
import { cn } from '~/lib/utils';

import { CalendarHeatmap, type CalendarColour } from './calendar';
import {
  CumulativeLines,
  DistanceElevationDots,
  Measure,
  PlainBars,
  SportBars,
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
  summary: (context: TileContext, option: string | undefined) => TileSummary;
  // The face's own small switch (first option is the default), if any.
  faceOptions?: readonly string[];
  face: (context: TileContext, option: string | undefined) => ReactNode;
  detail: (context: TileContext, option: string | undefined) => ReactNode;
};

const metricFaceOptions = ['distance', 'time', 'elevation'] as const;

// Short labels for the face switches, which have little room.
export const faceOptionLabels: Record<string, string> = {
  distance: 'km',
  time: 'h',
  elevation: 'm',
  hours: 'h',
  days: 'days',
};

export const optionLabels: Record<string, string> = {
  ...metricLabel,
  sport: 'Sport',
  currentYear: 'This year',
  allTime: 'All time',
  last12Weeks: '12 weeks',
  last52Weeks: '52 weeks',
  hours: 'Hours',
  days: 'Active days',
};

function Delta({
  current,
  previous,
  text,
}: {
  current: number;
  previous: number;
  text: string;
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
        {change >= 0 ? '+' : ''}
        {change}%
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
  return (
    <Measure className="mt-2 min-h-0 flex-1">
      {children}
    </Measure>
  );
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
          text={`vs last year by ${shortDate(dateOfDay(today))}`}
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

// Totals --------------------------------------------------------------------

const totalsView: TileView = {
  period: ({ today }) => String(dateOfDay(today).getUTCFullYear()),
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'count');
    return {
      value: formatMetric(totals(activities, today)[metric], metric),
      unit: metricUnit[metric],
      sub: `${metricLabel[metric]} this year so far`,
    };
  },
  face: ({ activities, today }) => {
    const values = totals(activities, today);
    return (
      <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-2">
        {(['distance', 'elevation', 'time'] as const).map((metric) => (
          <div key={metric} className="min-w-0">
            <div className="truncate text-[11px] text-muted-foreground">
              {metricLabel[metric]}
            </div>
            <div className="truncate font-mono text-[15px] font-medium tabular-nums">
              {formatMetric(values[metric], metric)}
              <small className="ml-0.5 text-[11px] font-normal text-muted-foreground">
                {metricUnit[metric]}
              </small>
            </div>
          </div>
        ))}
      </div>
    );
  },
  detail: (context, option) => {
    const metric = asMetric(option, 'count');
    const years = totalsByYear(context.activities, context.today, metric);
    const rows = years.flatMap(({ year, bySport }) =>
      Object.entries(bySport).map(([sport, value]) => ({
        x: String(year),
        sport: sport as keyof typeof bySport,
        value,
      })),
    );
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
              palette={context.palette}
              valueFormat={(value) => formatWithUnit(value, metric)}
            />
          )}
        </DetailChart>
        <Legend sports={sports} />
        <p className="text-xs text-muted-foreground">
          This year runs to {shortDate(dateOfDay(context.today))}.
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

const weeklyVolumeView: TileView = {
  period: () => 'Last 12 weeks',
  summary: ({ activities, today }, option) => {
    const metric = asMetric(option, 'distance');
    const { values } = weeklyVolume(activities, today, metric);
    const fullWeeks = values.slice(0, -1);
    const average =
      fullWeeks.reduce((sum, value) => sum + value, 0) / fullWeeks.length;
    return {
      value: formatMetric(values.at(-1) ?? 0, metric),
      unit: metricUnit[metric],
      sub: `this week · average ${formatWithUnit(average, metric)}`,
    };
  },
  faceOptions: metricFaceOptions,
  face: (context, option) => {
    const metric = asMetric(option, 'distance');
    return (
      <FillChart>
        {({ width, height }) => (
          <SportBars
            rows={weekRows(context, metric)}
            width={width}
            height={height}
            detail={false}
            palette={context.palette}
            valueFormat={(value) => formatWithUnit(value, metric)}
            xTickFormat={weekOf}
          />
        )}
      </FillChart>
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
  summary: ({ activities, today }) => ({
    value: String(activityCalendar(activities, today).activeDays),
    unit: 'active days',
    sub: 'in the last 12 months',
  }),
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
    return (
      <FillChart>
        {({ width, height }) => (
          <CalendarHeatmap
            today={context.today}
            weeks={Math.max(8, Math.min(53, Math.floor(width / (height / 7))))}
            width={width}
            height={height}
            dominantSport={dominantSport}
            totals={days}
            colour="sport"
            palette={context.palette}
            labels={false}
          />
        )}
      </FillChart>
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
          text={`vs last month by day ${dateOfDay(today).getUTCDate()}`}
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
        <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
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

// Moving time per week, the last week so far; the average is over the full
// weeks before it.
function hoursPerWeek(context: TileContext, weeks: number) {
  const { weekStarts, values } = weeklyVolume(
    context.activities,
    context.today,
    'time',
    weeks,
  );
  const fullWeeks = values.slice(0, -1);
  return {
    rows: weekStarts.map((weekStart, index) => ({
      weekStart,
      hours: values[index]!,
    })),
    average:
      fullWeeks.reduce((sum, value) => sum + value, 0) / fullWeeks.length,
  };
}

const consistencyView: TileView = {
  period: () => 'Last 12 weeks',
  // The face switches between hours and active days per week; the detail's
  // option is its range and always shows hours.
  summary: (context, option) => {
    const weeks = weeksOf(option);
    const result = consistency(context.activities, context.today, weeks);
    const streak = `Current streak ${result.currentStreak} ${
      result.currentStreak === 1 ? 'day' : 'days'
    }`;
    if (option === 'days')
      return {
        value: result.activeDaysPerWeek.toFixed(1),
        unit: 'days / week',
        sub: streak,
      };
    return {
      value: formatMetric(hoursPerWeek(context, weeks).average, 'time'),
      unit: 'h / week',
      sub: streak,
    };
  },
  faceOptions: ['hours', 'days'],
  face: (context, option) => (
    <FillChart>
      {({ width, height }) => (
        <PlainBars
          rows={
            option === 'days'
              ? activeDaysPerWeek(context.activities, context.today, 12).map(
                  (week, index, weeks) => ({
                    x: String(week.weekStart),
                    value: week.activeDays,
                    highlight: index === weeks.length - 1,
                  }),
                )
              : hoursPerWeek(context, 12).rows.map((week, index, weeks) => ({
                  x: String(week.weekStart),
                  value: week.hours,
                  highlight: index === weeks.length - 1,
                }))
          }
          width={width}
          height={height}
          detail={false}
          palette={context.palette}
          xTickFormat={weekOf}
          valueFormat={(value) =>
            option === 'days' ? `${value} days` : formatWithUnit(value, 'time')
          }
        />
      )}
    </FillChart>
  ),
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

const distanceVsElevationView: TileView = {
  period: () => 'Last 12 months',
  summary: ({ activities, today }) => {
    const { points, metersPerKm } = distanceVsElevation(activities, today);
    return {
      value: formatMetric(metersPerKm, 'elevation'),
      unit: 'm / km',
      sub: `${points.length} activities, average climb rate`,
    };
  },
  face: ({ activities, today }) => (
    <FillChart>
      {({ width, height }) => (
        <DistanceElevationDots
          points={distanceVsElevation(activities, today).points}
          width={width}
          height={height}
          detail={false}
        />
      )}
    </FillChart>
  ),
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

// Speed trend is optional in the manifest and has no rules or fixtures yet,
// so no platform draws it.
export function tileView(id: StatsTileID): TileView | null {
  switch (id) {
    case 'yearToDate':
      return yearToDateView;
    case 'totals':
      return totalsView;
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
