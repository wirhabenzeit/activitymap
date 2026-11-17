'use client';

import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';
import { useBrowsingState } from '~/hooks/use-browsing-context';
import { useMonthRangePreference } from '~/hooks/use-month-range-preference';
import { formatPreferredDate } from '~/lib/date-preferences';
import { comparisonBand } from '~/lib/stats/comparison-band';
import { periodComparisons } from '~/lib/stats/history';
import { monthActivityRhythm } from '~/lib/stats/period-rhythm';
import { sportOrder } from '~/lib/stats/tile-data';
import { cumulativeByDay, dateOfDay } from '~/lib/stats/tile-series';
import { cn } from '~/lib/utils';
import { categorySettings } from '~/settings/category';
import type { StatsMetric } from '~/settings/stats-tiles.generated';

import { ExplorerActivities } from './explorer-activities';
import { ExplorerChart } from './explorer-chart';
import { ExplorerData, ExplorerHeader } from './explorer-layout';
import { monthName, statsFormat } from './format';
import { HeadlineValue } from './headline-value';
import type { TileContext } from './tiles';

const chartTitles: Record<StatsMetric, { cumulative: string; daily: string }> =
  {
    distance: { cumulative: 'Distance accumulated', daily: 'Daily distance' },
    time: { cumulative: 'Moving time accumulated', daily: 'Daily moving time' },
    elevation: {
      cumulative: 'Elevation accumulated',
      daily: 'Daily elevation',
    },
    count: { cumulative: 'Activities accumulated', daily: 'Daily activities' },
  };

export function MonthExplorer({
  context,
  metric,
}: {
  context: TileContext;
  metric: StatsMetric;
}) {
  const [savedDay, setDay] = useBrowsingState('stats:monthDay', null);
  const [savedComparison, setComparison] = useBrowsingState(
    'stats:comparison:month',
    0,
  );
  const [showRange, setShowRange] = useMonthRangePreference();
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [hoverComparison, setHoverComparison] = useState<string | null>(null);
  const { formatWithUnit, formatShort, formatMetric, metricUnit } = statsFormat(
    context.units,
  );
  const date = dateOfDay(context.today);
  const longMonth = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'long',
      year: 'numeric',
    });
  const dateLabel = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'short',
      day: 'numeric',
    });
  const data = useMemo(() => {
    const rows = periodComparisons(
      context.activities,
      context.today,
      metric,
      'months',
    );
    const rhythm = monthActivityRhythm(
      context.activities,
      context.today,
      metric,
    );
    const lines = rows.map((row, index) => ({
      key: String(row.start),
      label: monthName(dateOfDay(row.start)),
      role: index === 0 ? ('current' as const) : ('comparison' as const),
      points: [
        { x: 0, y: 0 },
        ...cumulativeByDay(
          context.activities,
          metric,
          row.start,
          Math.min(row.end, row.start + rhythm.days.length - 1),
        ).map((y, index) => ({ x: index + 1, y })),
      ],
    }));
    const columns = rhythm.days.map((day, index) => ({
      key: day.day,
      label: `${monthName(dateOfDay(context.today))} ${index + 1}`,
      x1: index + 0.6,
      x2: index + 1.4,
      values: day.bySport,
      disabled: day.day > context.today,
      activityCount: day.activities.length,
    }));
    return { rows, lines, rhythm, columns };
  }, [context.activities, context.today, metric]);
  const band = useMemo(
    () => comparisonBand(context.activities, context.today, metric, 'month'),
    [context.activities, context.today, metric],
  );
  const historyDate = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  const rangeExplanation = band
    ? `The 5th–95th percentile of cumulative totals at each day of the month, based on ${band.count} completed months from ${historyDate(band.first)} to ${historyDate(band.last)}. The band shows those past months through the end of the month, including days beyond ${dateLabel(context.today)}; it is historical context, not a forecast. The current month and partial opening month are excluded. Uses your activity filters.`
    : 'Historical range needs at least two completed months of activity history.';
  const current = data.rows[0]!;
  const comparison =
    data.rows.find(
      (row, index) => index > 0 && row.start === savedComparison,
    ) ?? data.rows[1]!;
  const difference = current.elapsed - comparison.elapsed;
  const formattedDifference = formatWithUnit(Math.abs(difference), metric);
  const comparisonMonth = formatPreferredDate(
    dateOfDay(comparison.start),
    context.dateFormat,
    undefined,
    { month: 'long' },
  );
  const comparisonSentence =
    difference === 0
      ? `Level with ${comparisonMonth} at this point.`
      : /^0(?:[.,]0+)?\s/.test(formattedDifference)
        ? `About level with ${comparisonMonth} at this point.`
        : `${formattedDifference} ${difference > 0 ? 'ahead of' : 'behind'} ${comparisonMonth} at this point.`;
  const latestDay =
    data.rhythm.days.filter((day) => day.activities.length > 0).at(-1)?.day ??
    context.today;
  const selectedDay = data.columns.some(
    (day) => day.key === savedDay && !day.disabled,
  )
    ? savedDay!
    : latestDay;
  const selected = data.rhythm.days.find((day) => day.day === selectedDay)!;
  const lines = data.lines.filter(
    (line, index) =>
      index === 0 ||
      line.key === String(comparison.start) ||
      line.key === hoverComparison,
  );
  const sports = sportOrder.filter((sport) =>
    data.rhythm.days.some((day) => day.bySport[sport] > 0),
  );
  return (
    <div data-period-explorer="month" className="mx-auto max-w-5xl">
      <ExplorerHeader context={context} title={longMonth(current.start)} />
      <div className="mb-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <HeadlineValue
            value={formatMetric(current.elapsed, metric)}
            unit={metricUnit[metric]}
          />
          <span className="text-sm text-muted-foreground">
            through {dateLabel(context.today)}
          </span>
        </p>
        <p className="mt-1 text-sm" aria-live="polite">
          {comparisonSentence}
        </p>
      </div>
      <section aria-label="Monthly activity charts">
        <div className="mb-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex flex-wrap items-center gap-2 text-muted-foreground">
            Comparing with{' '}
            <select
              aria-label="Comparison month"
              value={comparison.start}
              onChange={(event) => setComparison(Number(event.target.value))}
              className="min-h-9 rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {data.rows.slice(1).map((row) => (
                <option key={row.start} value={row.start}>
                  {longMonth(row.start)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={showRange}
                onChange={(event) => setShowRange(event.target.checked)}
                className="size-4 accent-current"
              />
              Historical range
            </label>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About historical range"
                    className="flex size-8 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Info aria-hidden="true" className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-80 text-sm leading-relaxed"
                >
                  {rangeExplanation}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <ExplorerChart
          label="Cumulative monthly totals and daily activity"
          titles={chartTitles[metric]}
          series={lines}
          band={
            showRange && band
              ? {
                  ...band,
                  points: band.points.filter(
                    (point) => point.x <= data.rhythm.days.length,
                  ),
                }
              : undefined
          }
          columns={data.columns}
          domain={[0, data.rhythm.days.length + 0.5]}
          ticks={[1, 8, 15, 22, 29]
            .filter((day) => day <= data.rhythm.days.length)
            .map((x) => ({ x, label: String(x) }))}
          selected={selectedDay}
          active={hoverDay}
          onActive={setHoverDay}
          onSelect={setDay}
          comparisonKey={hoverComparison ?? String(comparison.start)}
          onComparison={setHoverComparison}
          formatValue={(value) => formatWithUnit(value, metric)}
          formatAxis={(value, step) => formatShort(value, metric, step)}
          reportingBoundary={{
            x: date.getUTCDate() + 0.5,
            label: `As of ${dateLabel(context.today)}`,
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {sports.map((sport) => (
            <span key={sport} className="flex items-center gap-1.5">
              <i
                className="size-2 rounded-full"
                style={{ background: categorySettings[sport].color }}
              />
              {categorySettings[sport].name}
            </span>
          ))}
        </div>
      </section>
      <ExplorerActivities
        context={context}
        activities={selected.activities}
        metric={metric}
        label={`${dateLabel(selectedDay)} · ${formatWithUnit(
          sportOrder.reduce((sum, sport) => sum + selected.bySport[sport], 0),
          metric,
        )} · ${selected.activities.length} ${selected.activities.length === 1 ? 'activity' : 'activities'}`}
        ariaLabel="Selected day activities"
        comfortable
        hideTotal
      />
      <ExplorerData>
        <section aria-label="Monthly comparisons">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-medium">Recent months</h2>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm whitespace-nowrap tabular-nums">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th scope="col" className="pb-2 text-left font-normal">
                    Month
                  </th>
                  <th scope="col" className="px-3 pb-2 text-right font-normal">
                    Through day {date.getUTCDate()}
                  </th>
                  <th scope="col" className="pb-2 text-right font-normal">
                    Full month
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.start}
                    data-comparison-row={row.start}
                    data-active={
                      String(row.start) ===
                      (hoverComparison ?? String(comparison.start))
                    }
                    className={cn(
                      'border-b border-muted',
                      row.start === comparison.start && 'bg-muted/40',
                    )}
                    onPointerEnter={() => setHoverComparison(String(row.start))}
                    onPointerLeave={() => setHoverComparison(null)}
                  >
                    <th scope="row" className="text-left font-normal">
                      {row.start === current.start ? (
                        <span className="block py-3 font-medium">
                          {longMonth(row.start)}{' '}
                          <span className="ml-1 text-sm font-normal text-muted-foreground">
                            so far
                          </span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Compare ${longMonth(row.start)}`}
                          aria-pressed={row.start === comparison.start}
                          onClick={() => setComparison(row.start)}
                          onFocus={() => setHoverComparison(String(row.start))}
                          onBlur={() => setHoverComparison(null)}
                          className="min-h-11 w-full py-2 text-left focus-visible:outline-2"
                        >
                          {longMonth(row.start)}
                          {row.start === comparison.start && (
                            <span className="ml-2 text-sm text-muted-foreground">
                              Comparing
                            </span>
                          )}
                        </button>
                      )}
                    </th>
                    <td className="px-3 py-3 text-right font-mono">
                      {formatWithUnit(row.elapsed, metric)}
                    </td>
                    <td className="py-3 text-right font-mono text-muted-foreground">
                      {row.start === current.start
                        ? '—'
                        : formatWithUnit(row.total, metric)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Comparisons use the same day of each month. Shorter months use their
            last day.
          </p>
        </section>
      </ExplorerData>
    </div>
  );
}
