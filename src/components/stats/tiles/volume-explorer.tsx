'use client';

import { useMemo, useState } from 'react';

import { useBrowsingState } from '~/hooks/use-browsing-context';
import { formatPreferredDate } from '~/lib/date-preferences';
import { volumeHistory, volumeHistoryAverage } from '~/lib/stats/history';
import { dayOf, sportOrder } from '~/lib/stats/tile-data';
import { dateOfDay } from '~/lib/stats/tile-series';
import { cn } from '~/lib/utils';
import { categorySettings } from '~/settings/category';
import type { StatsMetric } from '~/settings/stats-tiles.generated';

import { StatsChoices } from './choices';
import { ExplorerActivities } from './explorer-activities';
import { ExplorerChart } from './explorer-chart';
import {
  ExplorerData,
  ExplorerHeader,
  ExplorerSportLegend,
} from './explorer-layout';
import { monthName, statsFormat } from './format';
import { HeadlineValue } from './headline-value';
import type { TileContext } from './tiles';

export function VolumeExplorer({
  context,
  metric,
}: {
  context: TileContext;
  metric: StatsMetric;
}) {
  const [range, setRange] = useBrowsingState('stats:volumeGrouping', 'weeks');
  const [saved, setSelected] = useBrowsingState('stats:volumePeriod', null);
  const [hover, setHover] = useState<number | null>(null);
  const buckets = useMemo(
    () => volumeHistory(context.activities, context.today, metric, range),
    [context.activities, context.today, metric, range],
  );
  const trend = useMemo(
    () =>
      volumeHistoryAverage(context.activities, context.today, metric, range),
    [context.activities, context.today, metric, range],
  );
  const selected = buckets.some((b) => b.start === saved)
    ? saved
    : buckets.at(-1)!.start;
  const active = hover ?? selected;
  const selectedBucket = buckets.find((b) => b.start === selected)!;
  const { formatWithUnit, formatShort, formatMetric, metricUnit } = statsFormat(
    context.units,
  );
  const dateLabel = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  const label = (start: number) =>
    range === 'years'
      ? String(dateOfDay(start).getUTCFullYear())
      : range === 'months'
        ? `${monthName(dateOfDay(start))} ${dateOfDay(start).getUTCFullYear()}`
        : `Week of ${dateLabel(start)}`;
  const sports = sportOrder.filter((s) =>
    buckets.some((b) => b.bySport[s] > 0),
  );
  const averageLabel = `4-${range === 'weeks' ? 'week' : range === 'months' ? 'month' : 'year'} average`;
  const columns = buckets.map((b, i) => ({
    key: b.start,
    label: label(b.start),
    tickLabel:
      range === 'years'
        ? String(dateOfDay(b.start).getUTCFullYear())
        : range === 'months'
          ? monthName(dateOfDay(b.start))
          : formatPreferredDate(
              dateOfDay(b.start),
              context.dateFormat,
              undefined,
              { month: 'short', day: 'numeric' },
            ),
    x1: i + 0.1,
    x2: i + 0.9,
    values: b.bySport,
    incomplete: b.incomplete,
  }));
  const activities = context.activities.filter((a) => {
    const day = dayOf(a.start_date_local);
    return day >= selectedBucket.start && day <= selectedBucket.end;
  });
  return (
    <div data-volume-explorer className="mx-auto max-w-5xl">
      <ExplorerHeader context={context} title="Training volume" />
      <div className="mb-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <HeadlineValue
            value={formatMetric(
              buckets.reduce((sum, bucket) => sum + bucket.total, 0),
              metric,
            )}
            unit={metricUnit[metric]}
          />
          <span className="text-sm text-muted-foreground">
            {range === 'years'
              ? 'over your recorded years'
              : `over 12 ${range}`}
          </span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {dateLabel(buckets[0]!.start)} – {dateLabel(buckets.at(-1)!.end)}
        </p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <StatsChoices
          compact
          label="Volume grouping"
          options={['weeks', 'months', 'years'] as const}
          value={range}
          onChange={setRange}
          accessibleLabel={(v) =>
            ({ weeks: 'By week', months: 'By month', years: 'By year' })[v]
          }
          visibleLabel={(v) =>
            ({ weeks: 'By week', months: 'By month', years: 'By year' })[v]
          }
        />
      </div>
      <section aria-label="Training volume chart" className="min-w-0">
        <h2 className="mb-1 text-sm font-semibold">
          Volume by{' '}
          {range === 'weeks' ? 'week' : range === 'months' ? 'month' : 'year'}
        </h2>
        <ExplorerChart
          label="Period totals by sport"
          refined
          columns={columns}
          domain={[0, buckets.length]}
          ticks={buckets.flatMap((b, i) =>
            i % Math.max(1, Math.ceil(buckets.length / 6)) === 0
              ? [
                  {
                    x: i + 0.5,
                    label:
                      range === 'years'
                        ? label(b.start)
                        : range === 'months'
                          ? monthName(dateOfDay(b.start))
                          : formatPreferredDate(
                              dateOfDay(b.start),
                              context.dateFormat,
                              undefined,
                              { month: 'short', day: 'numeric' },
                            ),
                  },
                ]
              : [],
          )}
          selected={selected}
          active={hover}
          onActive={setHover}
          onSelect={setSelected}
          formatValue={(v) => formatWithUnit(v, metric)}
          formatAxis={(v, step) => formatShort(v, metric, step)}
          trend={trend.map((p) => ({
            x: buckets.findIndex((b) => String(b.start) === p.x) + 0.5,
            value: p.value,
          }))}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <ExplorerSportLegend sports={sports} />
          <p className="mt-2 text-sm text-muted-foreground">
            Dashed: {averageLabel}
          </p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Faded bars show incomplete periods. The average uses completed
          periods.
        </p>
      </section>
      <ExplorerActivities
        context={context}
        activities={activities}
        label={`${label(selected!)} · ${formatWithUnit(selectedBucket.total, metric)} · ${activities.length} ${activities.length === 1 ? 'activity' : 'activities'}`}
        comfortable
        hideTotal
        metric={metric}
      />
      <ExplorerData>
        <section aria-label="Period totals" className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-medium">Period totals</h2>
          </div>
          <div
            className="max-h-80 overflow-auto"
            tabIndex={0}
            role="region"
            aria-label="Period totals by sport"
          >
            <table className="w-full text-sm whitespace-nowrap">
              <caption className="sr-only">
                Period totals by sport, {metric}. Incomplete periods are marked.
              </caption>
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th scope="col" className="p-3 text-left font-normal">
                    {range === 'weeks'
                      ? 'Week'
                      : range === 'months'
                        ? 'Month'
                        : 'Year'}
                  </th>
                  {sports.map((s) => (
                    <th
                      scope="col"
                      key={s}
                      className="px-2 text-right font-normal"
                    >
                      {categorySettings[s].name}
                    </th>
                  ))}
                  <th scope="col" className="pr-3 text-right font-normal">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr
                    key={b.start}
                    data-volume-row={b.start}
                    data-active={active === b.start}
                    className={cn(
                      'border-t border-muted',
                      active === b.start && 'bg-header-background/10',
                    )}
                    onPointerEnter={() => setHover(b.start)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <th scope="row" className="text-left font-normal">
                      <button
                        type="button"
                        aria-pressed={selected === b.start}
                        className="min-h-11 w-full px-3 py-2 text-left focus-visible:outline-2"
                        onFocus={() => setHover(b.start)}
                        onBlur={() => setHover(null)}
                        onClick={() => setSelected(b.start)}
                      >
                        {range === 'weeks'
                          ? dateLabel(b.start)
                          : label(b.start)}
                        {b.incomplete && (
                          <span className="block text-xs text-muted-foreground">
                            Incomplete
                          </span>
                        )}
                      </button>
                    </th>
                    {sports.map((s) => (
                      <td key={s} className="px-2 text-right font-mono">
                        {formatWithUnit(b.bySport[s], metric)}
                      </td>
                    ))}
                    <td className="pr-3 text-right font-mono font-medium">
                      {formatWithUnit(b.total, metric)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Hover a row to highlight its bar. Select to see activities.
          </p>
        </section>
      </ExplorerData>
    </div>
  );
}
