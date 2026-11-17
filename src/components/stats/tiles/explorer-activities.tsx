'use client';

import { formatPreferredDate } from '~/lib/date-preferences';
import {
  type StatsActivity,
  compareStatsActivities,
  dayOf,
  metricValue,
} from '~/lib/stats/tile-data';
import { dateOfDay } from '~/lib/stats/tile-series';
import type { StatsMetric } from '~/settings/stats-tiles.generated';

import { ActivityRow } from './activity-row';
import { statsFormat } from './format';
import type { TileContext } from './tiles';

export function ExplorerActivities({
  context,
  activities,
  label,
  metric = 'distance',
  ariaLabel = 'Selected period activities',
  comfortable = false,
  hideTotal = false,
}: {
  context: TileContext;
  activities: readonly StatsActivity[];
  label: string;
  metric?: StatsMetric;
  ariaLabel?: string;
  comfortable?: boolean;
  hideTotal?: boolean;
}) {
  const { formatWithUnit } = statsFormat(context.units);
  return (
    <section aria-label={ariaLabel} className="mt-4 border-t pt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          className={
            comfortable ? 'text-base font-medium' : 'text-sm font-medium'
          }
        >
          {label}
        </h2>
        {!hideTotal && (
          <span
            className={
              comfortable
                ? 'text-sm text-muted-foreground'
                : 'text-xs text-muted-foreground'
            }
          >
            {activities.length}{' '}
            {activities.length === 1 ? 'activity' : 'activities'} ·{' '}
            {formatWithUnit(
              activities.reduce((sum, a) => sum + metricValue(a, metric), 0),
              metric,
            )}
          </span>
        )}
      </div>
      {activities.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No matching activities in this period.
        </p>
      ) : (
        <div className="max-h-72 divide-y divide-muted overflow-y-auto overscroll-contain">
          {[...activities].sort(compareStatsActivities).map((a, index) => (
            <ActivityRow
              key={a.id ?? index}
              activityId={a.id}
              comfortable={comfortable}
              sport={a.sport}
              name={a.name}
              selected={
                a.id !== undefined && a.id === context.selectedActivityId
              }
              summary={`${formatPreferredDate(dateOfDay(dayOf(a.start_date_local)), context.dateFormat, undefined, { month: 'short', day: 'numeric' })} · ${formatWithUnit(metricValue(a, metric), metric)}`}
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
  );
}
