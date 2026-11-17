'use client';

import { useMemo, useState } from 'react';

import { useBrowsingState } from '~/hooks/use-browsing-context';
import { formatPreferredDate } from '~/lib/date-preferences';
import { volumeHistory } from '~/lib/stats/history';
import {
  climbing,
  dayOf,
  sameDateLastYear,
  sportOrder,
} from '~/lib/stats/tile-data';
import { dateOfDay } from '~/lib/stats/tile-series';
import { categorySettings } from '~/settings/category';

import { ActivityRow } from './activity-row';
import { StatsChoices } from './choices';
import { ExplorerChart } from './explorer-chart';
import { ExplorerHeader } from './explorer-layout';
import { monthName, statsFormat } from './format';
import type { TileContext } from './tiles';

export function HillinessExplorer({ context }: { context: TileContext }) {
  const [savedSport, setSport] = useBrowsingState(
    'stats:hillinessSport',
    'ride',
  );
  const [savedMonth, setMonth] = useBrowsingState('stats:hillinessMonth', null);
  const [hover, setHover] = useState<number | null>(null);
  const {
    formatWithUnit,
    formatHilliness,
    formatHillinessAxis,
    hillinessUnit,
  } = statsFormat(context.units);
  const first = sameDateLastYear(context.today);
  const measured = useMemo(
    () =>
      context.activities.filter(
        (a) =>
          (a.distance ?? 0) > 0 &&
          a.total_elevation_gain !== null &&
          dayOf(a.start_date_local) <= context.today,
      ),
    [context.activities, context.today],
  );
  const sports = sportOrder.filter((s) =>
    measured.some((a) => a.sport === s && dayOf(a.start_date_local) >= first),
  );
  const dominant = [...sports].sort((a, b) =>
    measured.reduce(
      (sum, r) =>
        dayOf(r.start_date_local) >= first
          ? sum +
            (r.sport === b
              ? (r.distance ?? 0)
              : r.sport === a
                ? -(r.distance ?? 0)
                : 0)
          : sum,
      0,
    ),
  )[0];
  const sport = sports.includes(savedSport) ? savedSport : dominant;
  const activities = useMemo(
    () => measured.filter((a) => a.sport === sport),
    [measured, sport],
  );
  const buckets = useMemo(
    () => volumeHistory(activities, context.today, 'distance', 'months'),
    [activities, context.today],
  );
  const chart = useMemo(
    () => climbing(activities, context.today),
    [activities, context.today],
  );
  const selected = buckets.some((b) => b.start === savedMonth)
    ? savedMonth
    : (buckets.filter((b) => b.total > 0).at(-1)?.start ??
      buckets.at(-1)!.start);
  const bucket = buckets.find((b) => b.start === selected)!;
  const selectedActivities = activities.filter((a) => {
    const day = dayOf(a.start_date_local);
    return day >= bucket.start && day <= bucket.end;
  });
  const distance = selectedActivities.reduce(
    (sum, a) => sum + (a.distance ?? 0) / 1000,
    0,
  );
  const ascent = selectedActivities.reduce(
    (sum, a) => sum + (a.total_elevation_gain ?? 0),
    0,
  );
  const ranked = selectedActivities
    .filter((a) => (a.distance ?? 0) >= 5000)
    .sort(
      (a, b) =>
        (b.total_elevation_gain ?? 0) / (b.distance ?? 1) -
        (a.total_elevation_gain ?? 0) / (a.distance ?? 1),
    );
  const label = (start: number) =>
    `${monthName(dateOfDay(start))} ${dateOfDay(start).getUTCFullYear()}`;
  if (!sport)
    return (
      <div data-hilliness-explorer className="mx-auto max-w-5xl">
        <ExplorerHeader context={context} title="Hilliness" />
        <p className="py-8 text-sm text-muted-foreground">
          No activities with recorded distance and ascent in the last 12 months.
        </p>
      </div>
    );
  return (
    <div data-hilliness-explorer className="mx-auto max-w-5xl">
      <ExplorerHeader context={context} title="Hilliness" />
      <div className="mb-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <strong className="text-4xl font-semibold tracking-tight tabular-nums">
            {formatHilliness(chart.current / 100)} {hillinessUnit}
          </strong>
          <span className="text-base text-muted-foreground">
            {categorySettings[sport].name} · last 12 months
          </span>
        </p>
        <p className="mt-1 text-base">
          Previous 12 months:{' '}
          {activities.some(
            (activity) =>
              dayOf(activity.start_date_local) >= sameDateLastYear(first) &&
              dayOf(activity.start_date_local) < first,
          )
            ? `${formatHilliness(chart.previous / 100)} ${hillinessUnit}`
            : 'no recorded ascent'}
          .
        </p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <StatsChoices
          compact
          label="Hilliness sport"
          options={sports}
          value={sport}
          onChange={setSport}
          accessibleLabel={(s) => categorySettings[s].name}
          visibleLabel={(s) => categorySettings[s].name}
        />
        <p className="text-sm text-muted-foreground">
          Compare routes within the same sport
        </p>
      </div>
      <section aria-label="Hilliness chart" className="min-w-0">
        <h2 className="mb-1 text-sm font-semibold">
          Monthly climbing per distance
        </h2>
        <ExplorerChart
          label={`Monthly hilliness for ${categorySettings[sport].name}`}
          refined
          columns={buckets.map((b, i) => ({
            key: b.start,
            label: label(b.start),
            tickLabel: monthName(dateOfDay(b.start)),
            x1: i + 0.1,
            x2: i + 0.9,
            values: { [sport]: chart.months[i]!.rate / 100 },
            incomplete: b.incomplete,
          }))}
          trend={buckets.map((_, index) => ({
            x: index + 0.5,
            value: chart.current / 100,
          }))}
          domain={[0, 12]}
          ticks={buckets.flatMap((b, i) =>
            i % 2 === 0
              ? [{ x: i + 0.5, label: monthName(dateOfDay(b.start)) }]
              : [],
          )}
          selected={selected}
          active={hover}
          onActive={setHover}
          onSelect={setMonth}
          formatValue={(v) => `${formatHilliness(v)} ${hillinessUnit}`}
          formatAxis={formatHillinessAxis}
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Dashed: your distance-weighted average over the last 12 months. Faded
          bars: incomplete months.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ascent divided by distance, using activities with both values
          recorded. Months without recorded distance have no bar.
        </p>
      </section>
      <section
        aria-label="Selected month hilliness"
        className="mt-4 min-w-0 border-t pt-4"
      >
        <h2 className="text-base font-medium">
          {label(selected!)} ·{' '}
          {distance > 0 ? formatHilliness(ascent / distance) : '—'}{' '}
          {hillinessUnit}
        </h2>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Distance</dt>
            <dd className="mt-1 font-mono">
              {formatWithUnit(distance, 'distance')}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ascent</dt>
            <dd className="mt-1 font-mono">
              {formatWithUnit(ascent, 'elevation')}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Measured activities</dt>
            <dd className="mt-1 tabular-nums">{selectedActivities.length}</dd>
          </div>
        </dl>
        <h3 className="mt-4 text-base font-medium">Hilliest activities</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatWithUnit(5, 'distance')} or more · ranked within this month
        </p>
        {ranked.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No qualifying activities in this month.
          </p>
        ) : (
          <div className="mt-2 max-h-72 divide-y divide-muted overflow-y-auto">
            {ranked.map((a, i) => (
              <ActivityRow
                key={a.id ?? i}
                activityId={a.id}
                comfortable
                sport={a.sport}
                name={a.name}
                selected={
                  a.id !== undefined && context.selectedActivityId === a.id
                }
                summary={`${formatPreferredDate(a.start_date_local, context.dateFormat, undefined, { month: 'short', day: 'numeric' })} · ${formatWithUnit((a.distance ?? 0) / 1000, 'distance')} · ${formatWithUnit(a.total_elevation_gain ?? 0, 'elevation')} climbed`}
                detail={`${formatHilliness((a.total_elevation_gain ?? 0) / ((a.distance ?? 1) / 1000))} ${hillinessUnit}`}
                onOpen={
                  a.id !== undefined && context.onOpenActivity
                    ? () => context.onOpenActivity!(a.id!)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
