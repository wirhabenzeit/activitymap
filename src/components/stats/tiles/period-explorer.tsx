'use client';

import { useMemo, useState } from 'react';

import { useBrowsingState } from '~/hooks/use-browsing-context';
import { useHistoricalRangePreference } from '~/hooks/use-month-range-preference';
import { formatPreferredDate } from '~/lib/date-preferences';
import { comparisonBand } from '~/lib/stats/comparison-band';
import { periodComparisons } from '~/lib/stats/history';
import { yearMonthlyRhythm } from '~/lib/stats/period-rhythm';
import { dayOf, metricValue, sportOrder } from '~/lib/stats/tile-data';
import {
  comparisonYear,
  cumulativeYearPoints,
  dateOfDay,
  monthStart,
  yearStart,
} from '~/lib/stats/tile-series';
import { cn } from '~/lib/utils';
import type { StatsMetric } from '~/settings/stats-tiles.generated';

import { ExplorerActivities } from './explorer-activities';
import { ExplorerChart } from './explorer-chart';
import {
  ExplorerData,
  ExplorerHeader,
  ExplorerSportLegend,
  HistoricalRangeControl,
} from './explorer-layout';
import { monthName, statsFormat } from './format';
import { HeadlineValue } from './headline-value';
import type { TileContext } from './tiles';

const chartTitles: Record<StatsMetric, { cumulative: string; daily: string }> =
  {
    distance: { cumulative: 'Distance accumulated', daily: 'Monthly distance' },
    time: {
      cumulative: 'Moving time accumulated',
      daily: 'Monthly moving time',
    },
    elevation: {
      cumulative: 'Elevation accumulated',
      daily: 'Monthly elevation',
    },
    count: {
      cumulative: 'Activities accumulated',
      daily: 'Monthly activities',
    },
  };

export function YearExplorer({
  context,
  metric,
}: {
  context: TileContext;
  metric: StatsMetric;
}) {
  const [savedMonth, setMonth] = useBrowsingState('stats:yearMonth', null);
  const [savedComparison, setComparison] = useBrowsingState(
    'stats:comparison:year',
    0,
  );
  const [showRange, setShowRange] = useHistoricalRangePreference('year');
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);
  const [hoverComparison, setHoverComparison] = useState<string | null>(null);
  const date = dateOfDay(context.today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const { formatWithUnit, formatShort, formatMetric, metricUnit } = statsFormat(
    context.units,
  );
  const dateLabel = formatPreferredDate(date, context.dateFormat, undefined, {
    month: 'short',
    day: 'numeric',
  });
  const data = useMemo(() => {
    const rows = periodComparisons(
      context.activities,
      context.today,
      metric,
      'years',
    );
    const lines = rows.map((row, index) => ({
      key: String(row.start),
      label: String(dateOfDay(row.start).getUTCFullYear()),
      role: index === 0 ? ('current' as const) : ('comparison' as const),
      points: cumulativeYearPoints(
        context.activities,
        metric,
        dateOfDay(row.start).getUTCFullYear(),
        row.end,
      ),
    }));
    return {
      rows,
      lines,
      band: comparisonBand(context.activities, context.today, metric, 'year'),
    };
  }, [context.activities, context.today, metric]);
  const current = data.rows[0]!;
  const comparison =
    data.rows.find(
      (row, index) => index > 0 && row.start === savedComparison,
    ) ?? data.rows[1];
  const comparedYear = comparison
    ? dateOfDay(comparison.start).getUTCFullYear()
    : year - 1;
  // The bars and headline follow the same comparison year as the cumulative line.
  const rhythm = useMemo(
    () =>
      yearMonthlyRhythm(
        context.activities,
        context.today,
        metric,
        comparedYear,
      ),
    [context.activities, context.today, metric, comparedYear],
  );
  const columns = rhythm.map((row, index) => ({
    key: row.start,
    label: `${monthName(dateOfDay(row.start))} ${year}`,
    tickLabel: monthName(dateOfDay(row.start)),
    x1: monthStart(comparisonYear, index) - yearStart(comparisonYear),
    x2: monthStart(comparisonYear, index + 1) - yearStart(comparisonYear) - 1,
    values: row.current,
    previous: comparison ? row.previous : undefined,
    incomplete: row.inProgress,
  }));
  const selected = columns.some((column) => column.key === savedMonth)
    ? savedMonth!
    : monthStart(year, month);
  const selectedColumn = columns.find((column) => column.key === selected)!;
  const end = Math.min(
    context.today,
    monthStart(year, dateOfDay(selected).getUTCMonth() + 1) - 1,
  );
  const activities = context.activities.filter((activity) => {
    const day = dayOf(activity.start_date_local);
    return day >= selected && day <= end;
  });
  const difference = current.elapsed - (comparison?.elapsed ?? 0);
  const formattedDifference = formatWithUnit(Math.abs(difference), metric);
  const comparisonSentence = !comparison
    ? context.activities.length
      ? 'Your first recorded year.'
      : 'No activities recorded yet.'
    : difference === 0
      ? `Level with ${comparedYear} at this point.`
      : /^0(?:[.,]0+)?\s/.test(formattedDifference)
        ? `About level with ${comparedYear} at this point.`
        : `${formattedDifference} ${difference > 0 ? 'ahead of' : 'behind'} ${comparedYear} at this point.`;
  const lines = data.lines.filter(
    (line, index) =>
      index === 0 ||
      line.key === String(comparison?.start) ||
      line.key === hoverComparison,
  );
  const sports = sportOrder.filter((sport) =>
    columns.some(
      (column) =>
        column.values[sport] > 0 || (column.previous?.[sport] ?? 0) > 0,
    ),
  );
  const cutoff =
    monthStart(comparisonYear, month) +
    date.getUTCDate() -
    1 -
    yearStart(comparisonYear);
  const band = data.band;
  const rangeExplanation = band
    ? `The minimum–maximum cumulative totals at each calendar date, based on ${band.count} completed years (${dateOfDay(band.first).getUTCFullYear()}–${dateOfDay(band.last).getUTCFullYear()}). These are the 0th–100th percentiles. The current year and partial opening year are excluded. The band continues beyond ${dateLabel} through the end of past years; it is historical context, not a forecast. February 29 uses February 28 in non-leap years. Uses your activity filters.`
    : 'Historical range needs at least two completed years of activity history.';
  return (
    <div data-period-explorer="year" className="mx-auto max-w-5xl">
      <ExplorerHeader context={context} title={`${year} so far`} />
      <div className="mb-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <HeadlineValue
            value={formatMetric(current.elapsed, metric)}
            unit={metricUnit[metric]}
          />
          <span className="text-sm text-muted-foreground">
            through {dateLabel}
          </span>
        </p>
        <p className="mt-1 text-sm" aria-live="polite">
          {comparisonSentence}
        </p>
      </div>
      <section aria-label="Yearly activity charts">
        <div className="mb-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            Comparing with
            <select
              aria-label="Comparison year"
              value={comparison?.start ?? ''}
              disabled={!comparison}
              onChange={(event) => setComparison(Number(event.target.value))}
              className="min-h-9 rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {!comparison && <option value="">No earlier year</option>}
              {data.rows.slice(1).map((row) => (
                <option key={row.start} value={row.start}>
                  {dateOfDay(row.start).getUTCFullYear()}
                </option>
              ))}
            </select>
          </label>
          <HistoricalRangeControl
            checked={showRange}
            onChange={setShowRange}
            explanation={rangeExplanation}
          />
        </div>
        <ExplorerChart
          label="Cumulative yearly totals and monthly activity comparison"
          titles={chartTitles[metric]}
          series={lines}
          band={showRange ? band : undefined}
          columns={columns}
          domain={[0, 365]}
          ticks={Array.from({ length: 12 }, (_, index) => ({
            x:
              (monthStart(comparisonYear, index) +
                monthStart(comparisonYear, index + 1) -
                1) /
                2 -
              yearStart(comparisonYear),
            label: monthName(dateOfDay(monthStart(year, index))),
          }))}
          selected={selected}
          active={hoverMonth}
          onActive={setHoverMonth}
          onSelect={setMonth}
          comparisonKey={hoverComparison ?? String(comparison?.start ?? '')}
          onComparison={setHoverComparison}
          comparisonLabel={comparison ? String(comparedYear) : undefined}
          formatValue={(value) => formatWithUnit(value, metric)}
          formatAxis={(value, step) => formatShort(value, metric, step)}
          reportingBoundary={{
            x: Math.min(365, cutoff + 0.5),
            label: `As of ${dateLabel}`,
            futureLabel: 'Rest of year',
          }}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <ExplorerSportLegend sports={sports} />
          {comparison && (
            <p className="mt-2 text-sm text-muted-foreground">
              Paired bars: {year} / {comparedYear} (faded)
            </p>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Completed months compare in full; {monthName(date)} compares through{' '}
          {dateLabel} in both years.
        </p>
      </section>
      <ExplorerActivities
        context={context}
        activities={activities}
        metric={metric}
        label={`${selectedColumn.label} · ${formatWithUnit(
          activities.reduce(
            (sum, activity) => sum + metricValue(activity, metric),
            0,
          ),
          metric,
        )} · ${activities.length} ${activities.length === 1 ? 'activity' : 'activities'}`}
        ariaLabel="Selected month activities"
        comfortable
        hideTotal
      />
      <ExplorerData>
        <section aria-label="Yearly comparisons">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-medium">Recorded years</h2>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm whitespace-nowrap tabular-nums">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th scope="col" className="pb-2 text-left font-normal">
                    Year
                  </th>
                  <th scope="col" className="px-3 pb-2 text-right font-normal">
                    Through {dateLabel}
                  </th>
                  <th scope="col" className="pb-2 text-right font-normal">
                    Full year
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
                      (hoverComparison ?? String(comparison?.start))
                    }
                    className={cn(
                      'border-b border-muted',
                      hoverComparison === String(row.start)
                        ? 'bg-header-background/10'
                        : row.start === comparison?.start && 'bg-muted/40',
                    )}
                    onPointerEnter={() => setHoverComparison(String(row.start))}
                    onPointerLeave={() => setHoverComparison(null)}
                  >
                    <th scope="row" className="text-left font-normal">
                      {row.start === current.start ? (
                        <span className="block py-3 font-medium">
                          {year}{' '}
                          <span className="ml-1 font-normal text-muted-foreground">
                            so far
                          </span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Compare ${dateOfDay(row.start).getUTCFullYear()}`}
                          aria-pressed={row.start === comparison?.start}
                          onClick={() => setComparison(row.start)}
                          onFocus={() => setHoverComparison(String(row.start))}
                          onBlur={() => setHoverComparison(null)}
                          className="min-h-11 w-full py-2 text-left focus-visible:outline-2"
                        >
                          {dateOfDay(row.start).getUTCFullYear()}
                          {row.start === comparison?.start && (
                            <span className="ml-2 text-muted-foreground">
                              Comparing
                            </span>
                          )}
                          {row.incomplete && (
                            <span className="ml-2 text-muted-foreground">
                              Partial history
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
            Comparisons use the same calendar date in each year. Hover a year to
            preview its line; select it to compare.
          </p>
        </section>
      </ExplorerData>
    </div>
  );
}
