'use client';

import { useMemo, useState } from 'react';

import { Button } from '~/components/ui/button';
import { formatPreferredDate } from '~/lib/date-preferences';
import { calendarDays, firstActivityDay } from '~/lib/stats/history';
import {
  metricValue,
  sameDateLastYear,
  sportOrder,
} from '~/lib/stats/tile-data';
import {
  calendarSummaryWindow,
  dailyTotals,
  dateOfDay,
} from '~/lib/stats/tile-series';
import { categorySettings } from '~/settings/category';
import { type StatsMetric } from '~/settings/stats-tiles.generated';

import { ActivityRow } from './activity-row';
import { WeekdayRows } from './calendar';
import { Measure } from './charts';
import { statsFormat } from './format';
import { type TileContext } from './tiles';

export { VolumeExplorer as VolumeHistory } from './volume-explorer';

export function CalendarHistory({
  context,
  colorBy,
  expanded,
}: {
  context: TileContext;
  colorBy: 'sport' | StatsMetric;
  expanded: boolean;
}) {
  if (expanded)
    return (
      <CalendarHistoryContent context={context} colorBy={colorBy} expanded />
    );
  return (
    <Measure retainSize className="flex min-h-0 flex-1 flex-col">
      {({ width, height }) => (
        <CalendarHistoryContent
          context={context}
          colorBy={colorBy}
          expanded={false}
          compactWindow={calendarSummaryWindow(context.today, width, height)}
        />
      )}
    </Measure>
  );
}

function CalendarHistoryContent({
  context,
  colorBy,
  expanded,
  compactWindow,
}: {
  context: TileContext;
  colorBy: 'sport' | StatsMetric;
  expanded: boolean;
  compactWindow?: ReturnType<typeof calendarSummaryWindow>;
}) {
  const { formatWithUnit } = statsFormat(context.units);
  const dateLabel = (day: number) =>
    formatPreferredDate(dateOfDay(day), context.dateFormat, undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const [localDay, setLocalDay] = useState<number | null>(null);
  const { selectedDay, setSelectedDay } = context.calendar ?? {
    selectedDay: localDay,
    setSelectedDay: setLocalDay,
  };
  const first = expanded
    ? Math.min(
        sameDateLastYear(context.today),
        firstActivityDay(context.activities, context.today),
      )
    : compactWindow!.first;
  const last = context.today;
  const { days, dominantSport, secondSport, mixedDays } = useMemo(
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
        <p className="pt-2 text-sm">
          <strong className="font-mono">{days.size}</strong> active days ·{' '}
          {dateLabel(first)} – {dateLabel(last)}
        </p>
      )}
      {!expanded && (
        <div className="space-y-1">
          <div
            data-calendar-summary-header
            className="flex min-h-8 items-center justify-between gap-2"
          >
            <p className="flex items-baseline gap-1 whitespace-nowrap">
              <strong className="font-mono text-xl leading-none font-medium">
                {days.size}
              </strong>
              <span className="text-xs text-muted-foreground">active days</span>
            </p>
            {context.calendarControls}
          </div>
          <p className="text-xs text-muted-foreground">
            {Math.round((days.size / (last - first + 1)) * 100)}% of days in the
            last {compactWindow!.weeks} weeks
          </p>
        </div>
      )}
      <div
        className={
          expanded ? 'grid min-w-0 gap-5' : 'flex min-h-0 flex-1 flex-col'
        }
      >
        <div
          className={
            expanded ? 'flex min-w-0 flex-col' : 'flex min-h-0 flex-1 flex-col'
          }
        >
          <WeekdayRows
            expanded={expanded}
            cellSize={expanded ? 20 : compactWindow!.cellSize}
            units={context.units}
            dateFormat={context.dateFormat}
            key={`${first}-${last}`}
            today={last}
            first={first}
            dominantSport={dominantSport}
            secondSport={secondSport}
            mixedDays={mixedDays}
            totals={totals}
            palette={context.palette}
            colorBy={colorBy}
            selectedDay={
              selectedDay !== null &&
              selectedDay >= first &&
              selectedDay <= last
                ? selectedDay
                : null
            }
            onSelectDay={(day) => {
              setSelectedDay(day);
              if (!expanded) {
                context.onExpand?.();
              }
            }}
            footer={
              <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] leading-4 text-muted-foreground">
                {sportOrder
                  .filter((sport) =>
                    [...days.values()].some((activities) =>
                      activities.some((activity) => activity.sport === sport),
                    ),
                  )
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
        {expanded &&
          selectedDay !== null &&
          selectedDay >= first &&
          selectedDay <= last && (
            <section
              className="mt-3 space-y-3 border-t pt-3"
              aria-label="Selected day activities"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-medium">
                  {dateLabel(selectedDay)}
                </h4>
                <Button
                  variant="ghost"
                  className="h-11"
                  aria-label="Close day details"
                  onClick={() => setSelectedDay(null)}
                >
                  Close
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Activities matching your current filters.
              </p>
              {selectedActivities.length === 0 ? (
                <p className="text-sm">No matching activities on this day.</p>
              ) : (
                <ul className="divide-y divide-muted">
                  {selectedActivities.map((activity, index) => (
                    <li key={activity.id ?? index}>
                      <ActivityRow
                        activityId={activity.id}
                        sport={activity.sport}
                        name={activity.name}
                        summary={`${categorySettings[activity.sport].name} · ${(
                          ['distance', 'elevation', 'time'] as const
                        )
                          .map((metric) =>
                            formatWithUnit(
                              metricValue(activity, metric),
                              metric,
                            ),
                          )
                          .join(' · ')}`}
                        onOpen={
                          activity.id !== undefined && context.onOpenActivity
                            ? () => context.onOpenActivity?.(activity.id!)
                            : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
      </div>
    </>
  );
}
