'use client';

import { interpolateRgb } from 'd3';
// Seven weekday rows with chronological week columns.

import {
  type ReactNode,
  useEffectEvent,
  useLayoutEffect,
  useState,
} from 'react';

import { useRetainedScrollRef } from '~/hooks/use-browsing-context';
import { type DateFormat, formatPreferredDate } from '~/lib/date-preferences';
import { type Sport } from '~/lib/stats/tile-data';
import { sameDateLastYear } from '~/lib/stats/tile-data';
import { calendarWeeks, dateOfDay } from '~/lib/stats/tile-series';
import { type UnitSystem } from '~/lib/units';
import { categorySettings } from '~/settings/category';
import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { browsing } from '~/store/browsing';

import { type TilePalette, monthName, statsFormat } from './format';
import { useDayGrid } from './use-day-grid';

export function WeekdayRows({
  today,
  dominantSport,
  totals,
  palette,
  footer,
  colorBy = 'sport',
  first = sameDateLastYear(today),
  expanded = false,
  cellSize = expanded ? 20 : 16,
  mixedDays = new Set<number>(),
  secondSport = new Map<number, Sport>(),
  onSelectDay,
  selectedDay,
  units,
  dateFormat,
}: {
  units?: UnitSystem;
  dateFormat?: DateFormat;
  today: number;
  dominantSport: Map<number, Sport>;
  totals: Map<number, Record<StatsMetric, number>>;
  palette: TilePalette;
  footer?: ReactNode;
  colorBy?: 'sport' | StatsMetric;
  first?: number;
  expanded?: boolean;
  cellSize?: number;
  mixedDays?: Set<number>;
  secondSport?: Map<number, Sport>;
  onSelectDay?: (day: number) => void;
  selectedDay?: number | null;
}) {
  const { formatWithUnit } = statsFormat(units);
  const [hover, setHover] = useState<string | null>(null);
  const weeks = calendarWeeks(today, first);
  const [scrollRef, retainScroll] = useRetainedScrollRef(
    'stats:calendarScroll',
  );
  const positionOnOpen = useEffectEvent(() => {
    if (!expanded) return;
    const element = scrollRef.current;
    if (!element) return;
    if (selectedDay != null && selectedDay >= first && selectedDay <= today) {
      const cell = element.querySelector<HTMLElement>(
        `[data-calendar-day="${selectedDay}"]`,
      );
      if (cell) {
        const bounds = cell.getBoundingClientRect();
        const viewport = element.getBoundingClientRect();
        if (bounds.left < viewport.left || bounds.right > viewport.right) {
          element.scrollLeft +=
            bounds.left -
            viewport.left -
            (element.clientWidth - bounds.width) / 2;
        }
      }
    } else if (!browsing.getState().positions['stats:calendarScroll']) {
      element.scrollLeft = element.scrollWidth;
    }
  });
  // Reveal the opening selection, then leave scrolling to the user and native
  // keyboard focus. Selecting another day must not reposition the timeline.
  useLayoutEffect(() => {
    positionOnOpen();
  }, [expanded, first, today]);
  const dayGrid = useDayGrid(
    first,
    today,
    selectedDay ?? today,
    'week-columns',
  );
  const max =
    colorBy === 'sport'
      ? 0
      : Math.max(0, ...Array.from(totals.values(), (day) => day[colorBy]));
  const numericLegend = colorBy !== 'sport' && (
    <div className="mt-1 flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
      <span>0</span>
      <span
        className="h-2 w-16 rounded"
        style={{
          background: `linear-gradient(to right, ${palette.empty}, ${palette.heat})`,
        }}
      />
      <span>{formatWithUnit(max, colorBy)}</span>
    </div>
  );

  const dayLabel = (day: number) => {
    const sport = dominantSport.get(day);
    const dayTotals = totals.get(day);
    return `${formatPreferredDate(dateOfDay(day), dateFormat, undefined, { month: 'short', day: 'numeric', year: 'numeric' })}: ${
      sport && dayTotals
        ? `${mixedDays.has(day) ? 'Multiple sports' : categorySettings[sport].name}, ${formatWithUnit(dayTotals[colorBy === 'sport' ? 'time' : colorBy], colorBy === 'sport' ? 'time' : colorBy)}`
        : 'no matching activities'
    }`;
  };
  return (
    <div
      className={`mt-2 flex min-h-0 flex-1 flex-col ${expanded ? '' : 'justify-center'}`}
    >
      <div
        className="flex shrink-0 gap-1"
        style={{
          width: expanded ? undefined : 40 + weeks.length * (cellSize + 2) - 2,
          maxWidth: '100%',
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div
          className={`grid w-7 shrink-0 gap-[2px] ${expanded ? 'pt-8 pb-3' : 'pt-7 pb-1'}`}
          style={{ gridTemplateRows: `repeat(7, ${cellSize}px)` }}
          aria-hidden="true"
        >
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => (
            <span
              key={weekday}
              className="self-center text-[10px] leading-none text-muted-foreground"
            >
              {weekday}
            </span>
          ))}
        </div>
        <div
          ref={expanded ? retainScroll : undefined}
          role={expanded ? 'region' : undefined}
          aria-label={expanded ? 'Activity calendar history' : undefined}
          tabIndex={expanded ? 0 : undefined}
          data-calendar-scroll={expanded ? '' : undefined}
          className={`relative min-w-0 flex-1 scroll-px-1 px-1 ${expanded ? 'overflow-x-auto overscroll-x-contain pb-3' : 'overflow-hidden pb-1'}`}
        >
          <div
            className="grid gap-[2px]"
            style={{
              gridTemplateColumns: `repeat(${weeks.length}, ${cellSize}px)`,
              width: weeks.length * (cellSize + 2) - 2,
            }}
          >
            {weeks.map((week, weekIndex) => {
              const firstDay = Math.max(first, week.start);
              const date = dateOfDay(firstDay);
              const monthStartIndex = week.days.findIndex(
                (day) => day !== null && dateOfDay(day).getUTCDate() === 1,
              );
              const monthStartDay = week.days[monthStartIndex];
              const boundaryTop = `calc((100% + 2px) * ${monthStartIndex} / 7 - 1px)`;
              const labelMonth =
                (weekIndex === 0 && date.getUTCDate() <= 21) ||
                monthStartIndex !== -1;
              const labelDate =
                monthStartDay != null ? dateOfDay(monthStartDay) : date;
              return (
                <div
                  key={week.start}
                  data-calendar-week={week.start}
                  className="flex min-h-0 min-w-0 flex-col"
                >
                  <div
                    className={`relative shrink-0 ${expanded ? 'h-8' : 'h-7'}`}
                    aria-hidden="true"
                  >
                    {labelMonth &&
                      (expanded || weekIndex < weeks.length - 2) && (
                        <span className="absolute left-0 text-[10px] leading-3 whitespace-nowrap text-muted-foreground">
                          {monthName(labelDate)}
                          {(expanded || labelDate.getUTCMonth() === 0) && (
                            <span className="block">
                              {labelDate.getUTCFullYear()}
                            </span>
                          )}
                        </span>
                      )}
                  </div>
                  <div
                    className="relative grid gap-[2px]"
                    style={{ gridTemplateRows: `repeat(7, ${cellSize}px)` }}
                  >
                    {monthStartIndex !== -1 && (
                      <span
                        aria-hidden="true"
                        data-calendar-month-boundary={monthStartDay}
                        className="pointer-events-none absolute inset-0 z-2"
                      >
                        {monthStartIndex > 0 && (
                          <>
                            <span
                              className="absolute top-0 -right-px w-[6px] translate-x-1/2 bg-card"
                              style={{ height: boundaryTop }}
                            />
                            <span
                              className="absolute -inset-x-px h-[6px] -translate-y-1/2 bg-card"
                              style={{ top: boundaryTop }}
                            />
                          </>
                        )}
                        <span
                          className="absolute bottom-0 -left-px w-[6px] -translate-x-1/2 bg-card"
                          style={{
                            top: monthStartIndex === 0 ? 0 : boundaryTop,
                          }}
                        />
                      </span>
                    )}
                    {week.days.map((day, index) => {
                      if (day === null) return <i key={index} />;
                      const sport = dominantSport.get(day);
                      const dayTotals = totals.get(day);
                      const label = dayLabel(day);
                      return (
                        <button
                          data-calendar-day={day}
                          type="button"
                          key={index}
                          {...dayGrid(day)}
                          aria-label={label}
                          aria-pressed={day === selectedDay}
                          title={label}
                          className="block min-w-0 rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
                          style={{
                            width: cellSize,
                            height: cellSize,
                            boxShadow:
                              day === selectedDay
                                ? `0 0 0 1px ${palette.empty}, 0 0 0 3px currentColor`
                                : undefined,
                            position: 'relative',
                            zIndex: day === selectedDay ? 3 : undefined,
                            background:
                              colorBy === 'sport'
                                ? sport
                                  ? mixedDays.has(day)
                                    ? `repeating-linear-gradient(135deg, ${categorySettings[sport].color} 0 3px, ${secondSport.has(day) ? categorySettings[secondSport.get(day)!].color : palette.empty} 3px 5px)`
                                    : categorySettings[sport].color
                                  : palette.empty
                                : interpolateRgb(
                                    palette.empty,
                                    palette.heat,
                                  )(
                                    max > 0
                                      ? (dayTotals?.[colorBy] ?? 0) / max
                                      : 0,
                                  ),
                          }}
                          onPointerEnter={() => setHover(label)}
                          onFocus={() => {
                            dayGrid(day).onFocus();
                            setHover(label);
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setHover(label);
                            onSelectDay?.(day);
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1.5 min-h-4 shrink-0 truncate text-[11px] leading-4">
        {selectedDay != null ? dayLabel(selectedDay) : (hover ?? '\u00a0')}
      </div>
      {colorBy === 'sport' ? footer : numericLegend}
    </div>
  );
}
