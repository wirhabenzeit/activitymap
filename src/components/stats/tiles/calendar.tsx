'use client';

// The activity calendar tile's grid: one row per month, one cell per day.

import { useState, useRef, type ReactNode } from 'react';

import { interpolateRgb } from 'd3';

import { categorySettings } from '~/settings/category';
import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { type Sport } from '~/lib/stats/tile-data';
import { dateOfDay, calendarMonths } from '~/lib/stats/tile-series';

import {
  formatWithUnit,
  monthName,
  shortDate,
  type TilePalette,
} from './format';

// The tile face's calendar: one row per month (oldest at the top), one cell
// per day of the month, coloured by the day's dominant sport. Hovering a day
// names it on a line above the legend, which stays visible.
export function MonthRows({
  today,
  dominantSport,
  totals,
  palette,
  footer,
  colorBy = 'sport',
  first,
  mixedDays = new Set<number>(),
  onSelectDay,
}: {
  today: number;
  dominantSport: Map<number, Sport>;
  totals: Map<number, Record<StatsMetric, number>>;
  palette: TilePalette;
  footer?: ReactNode;
  colorBy?: 'sport' | StatsMetric;
  first?: number;
  mixedDays?: Set<number>;
  onSelectDay?: (day: number) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const months = calendarMonths(today, first);
  const [focusedDay, setFocusedDay] = useState(today);
  const cells = useRef(new Map<number, HTMLButtonElement>());
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

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col">
      <div
        className="grid min-h-0 flex-1 gap-[2px]"
        style={{ gridTemplateRows: `repeat(${months.length}, minmax(0, 1fr))` }}
        onPointerLeave={() => setHover(null)}
      >
        {months.map((month) => (
          <div key={month.start} className="flex min-h-0 items-stretch gap-1">
            <span className="w-11 shrink-0 self-center text-[10px] leading-none text-muted-foreground">
              {`${monthName(dateOfDay(month.start))} '${String(dateOfDay(month.start).getUTCFullYear()).slice(-2)}`}
            </span>
            <div
              className="grid min-w-0 flex-1 gap-[2px]"
              style={{ gridTemplateColumns: 'repeat(31, minmax(0, 1fr))' }}
            >
              {Array.from({ length: 31 }, (_, index) => {
                const day = month.start + index;
                if (
                  index >= month.length ||
                  day < month.first ||
                  day > month.last
                )
                  return <i key={index} />;
                const sport = dominantSport.get(day);
                const dayTotals = totals.get(day);
                const label = `${shortDate(dateOfDay(day))}, ${dateOfDay(day).getUTCFullYear()}: ${
                  sport && dayTotals
                    ? `${mixedDays.has(day) ? 'Multiple sports' : categorySettings[sport].name}, ${formatWithUnit(dayTotals[colorBy === 'sport' ? 'time' : colorBy], colorBy === 'sport' ? 'time' : colorBy)}`
                    : 'no matching activities'
                }`;
                return (
                  <button
                    type="button"
                    key={index}
                    ref={(element) => {
                      if (element) cells.current.set(day, element);
                      else {
                        // This is a DOM-ref Map, not a database operation.
                        // eslint-disable-next-line drizzle/enforce-delete-with-where
                        cells.current.delete(day);
                      }
                    }}
                    tabIndex={day === focusedDay ? 0 : -1}
                    aria-label={label}
                    title={label}
                    className="block min-w-0 rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
                    style={{
                      background:
                        colorBy === 'sport'
                          ? sport
                            ? mixedDays.has(day)
                              ? `repeating-linear-gradient(135deg, ${categorySettings[sport].color} 0 3px, ${palette.empty} 3px 5px)`
                              : categorySettings[sport].color
                            : palette.empty
                          : interpolateRgb(
                              palette.empty,
                              palette.heat,
                            )(max > 0 ? (dayTotals?.[colorBy] ?? 0) / max : 0),
                    }}
                    onPointerEnter={() => setHover(label)}
                    onFocus={() => {
                      setFocusedDay(day);
                      setHover(label);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setHover(label);
                      onSelectDay?.(day);
                    }}
                    onKeyDown={(event) => {
                      const offsets: Record<string, number> = {
                        ArrowLeft: -1,
                        ArrowRight: 1,
                        ArrowUp: -7,
                        ArrowDown: 7,
                      };
                      const offset = offsets[event.key];
                      if (offset !== undefined) {
                        event.preventDefault();
                        cells.current
                          .get(
                            Math.max(
                              months[0]!.first,
                              Math.min(today, day + offset),
                            ),
                          )
                          ?.focus();
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 min-h-4 shrink-0 truncate text-[11px] leading-4">
        {hover ?? '\u00a0'}
      </div>
      {colorBy === 'sport' ? footer : numericLegend}
    </div>
  );
}
