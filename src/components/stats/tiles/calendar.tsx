'use client';

// The activity calendar tile's grid: one row per month, one cell per day.

import { useState, useRef, type ReactNode } from 'react';

import { interpolateRgb } from 'd3';

import { categorySettings } from '~/settings/category';
import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { mondayOf, type Sport } from '~/lib/stats/tile-data';
import { cn } from '~/lib/utils';
import { dateOfDay, calendarMonths } from '~/lib/stats/tile-series';

import {
  formatWithUnit,
  monthName,
  shortDate,
  type TilePalette,
} from './format';

// The tile face's calendar: one row per month (oldest at the top), one cell
// per day of the month, coloured by the day's dominant sport. Hovering a day
// names it in the footer, in place of the legend.
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
    <div className="mt-1.5 flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
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
      {hover ? (
        <div className="mt-1.5 min-h-4 shrink-0 text-[11px] leading-4">
          {hover}
        </div>
      ) : colorBy === 'sport' ? (
        footer
      ) : (
        numericLegend
      )}
    </div>
  );
}

// The detailed consistency chart keeps days inspectable even over 52 weeks.
export function ConsistencyCalendar({
  today,
  first,
  weeks,
  flags,
}: {
  today: number;
  first: number;
  weeks: number;
  flags: boolean[];
}) {
  const [selected, setSelected] = useState(today);
  const day = Math.max(first, Math.min(today, selected));
  const cells = useRef(new Map<number, HTMLButtonElement>());
  const labelFor = (value: number) =>
    `${shortDate(dateOfDay(value))}, ${dateOfDay(value).getUTCFullYear()}: ${flags[value - first] ? 'activity recorded' : 'no matching activity'}`;
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs" aria-live="polite">
        {labelFor(day)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        Select a day to inspect it. Weeks run left to right; use arrow keys to
        move between days.
      </p>
      <div className="overflow-x-auto pb-2">
        <div
          role="group"
          aria-label={`Active days, last ${weeks} weeks`}
          className="grid gap-1"
          style={{
            minWidth: 36 + weeks * 24,
            gridTemplateColumns: `32px repeat(${weeks}, minmax(20px, 1fr))`,
            gridTemplateRows: '20px repeat(7, 24px)',
          }}
        >
          {Array.from(
            { length: weeks },
            (_, week) =>
              week % 4 === 0 && (
                <span
                  key={week}
                  className="whitespace-nowrap text-[10px] text-muted-foreground"
                  style={{
                    gridColumn: `${week + 2} / span ${Math.min(4, weeks - week)}`,
                    gridRow: 1,
                  }}
                >
                  {shortDate(dateOfDay(first + week * 7))}
                </span>
              ),
          )}
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
            (name, weekday) => (
              <span
                key={name}
                className="sticky left-0 z-10 flex h-full items-center bg-card text-[10px] text-muted-foreground"
                style={{ gridColumn: 1, gridRow: weekday + 2 }}
              >
                {name}
              </span>
            ),
          )}
          {Array.from({ length: today - first + 1 }, (_, index) => {
            const value = first + index;
            return (
              <button
                key={value}
                type="button"
                ref={(element) => {
                  if (element) cells.current.set(value, element);
                  else {
                    // DOM references only; no database operation.
                    // eslint-disable-next-line drizzle/enforce-delete-with-where
                    cells.current.delete(value);
                  }
                }}
                aria-label={labelFor(value)}
                aria-pressed={day === value}
                title={labelFor(value)}
                tabIndex={day === value ? 0 : -1}
                className={cn(
                  'flex items-center justify-center rounded-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground',
                  day === value &&
                    'bg-muted ring-1 ring-inset ring-muted-foreground',
                )}
                style={{
                  gridColumn: Math.floor(index / 7) + 2,
                  gridRow: (index % 7) + 2,
                }}
                onClick={() => setSelected(value)}
                onFocus={() => setSelected(value)}
                onKeyDown={(event) => {
                  const offsets: Record<string, number> = {
                    ArrowLeft: -7,
                    ArrowRight: 7,
                    ArrowUp: -1,
                    ArrowDown: 1,
                  };
                  const offset = offsets[event.key];
                  if (offset !== undefined) {
                    event.preventDefault();
                    cells.current
                      .get(Math.max(first, Math.min(today, value + offset)))
                      ?.focus();
                  }
                }}
              >
                <i
                  aria-hidden="true"
                  className={cn(
                    'size-2.5 rounded-full',
                    flags[index]
                      ? 'bg-foreground'
                      : 'border border-muted-foreground/40',
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Filled: activity recorded · Hollow: no matching activity · Current week
        is incomplete
      </p>
    </div>
  );
}

// Weeks run left to right; weekdays run Monday to Sunday down each column.
export function RestDayCalendar({
  today,
  flags,
  expanded,
}: {
  today: number;
  flags: boolean[];
  expanded: boolean;
}) {
  const first = today - flags.length + 1;
  const firstMonday = mondayOf(first);
  const weeks = Math.floor((today - firstMonday) / 7) + 1;
  const [selected, setSelected] = useState<number | null>(null);
  const [focusedDay, setFocusedDay] = useState(today);
  const cells = useRef(new Map<number, HTMLButtonElement>());
  const labelFor = (day: number) =>
    `${shortDate(dateOfDay(day))}: ${flags[day - first] ? 'activity recorded' : 'no matching activity'}`;
  const caption =
    selected !== null && selected >= first && selected <= today
      ? labelFor(selected)
      : `${shortDate(dateOfDay(first))} – ${shortDate(dateOfDay(today))} · weeks →`;

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1">
      <p className="shrink-0 text-[10px] leading-3" aria-live="polite">
        {caption}
      </p>
      <div
        role="group"
        aria-label="Last 90 days, one column per week, Monday to Sunday"
        className="grid min-h-0 gap-[2px]"
        style={{
          gridTemplateColumns: `24px repeat(${weeks}, minmax(0, 1fr))`,
          gridTemplateRows: 'repeat(7, minmax(0, 1fr))',
          height: expanded ? 168 : 56,
        }}
      >
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
          (name, weekday) => (
            <span
              key={name}
              className="self-center text-[9px] leading-none text-muted-foreground"
              style={{ gridRow: weekday + 1, gridColumn: 1 }}
            >
              {expanded || weekday % 2 === 0 ? name : ''}
            </span>
          ),
        )}
        {Array.from({ length: weeks * 7 }, (_, index) => {
          const day = firstMonday + index;
          // Partial weeks are blank: neither future days nor days before the
          // 90-day reporting window should be mistaken for rest days.
          if (day < first || day > today) return null;
          return (
            <button
              key={day}
              type="button"
              ref={(element) => {
                if (element) cells.current.set(day, element);
                else {
                  // DOM references only; no database operation.
                  // eslint-disable-next-line drizzle/enforce-delete-with-where
                  cells.current.delete(day);
                }
              }}
              tabIndex={day === focusedDay ? 0 : -1}
              aria-label={labelFor(day)}
              title={labelFor(day)}
              className={cn(
                'min-h-0 min-w-0 rounded-[1px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground',
                flags[day - first]
                  ? 'bg-muted-foreground/25'
                  : 'bg-orange-600 dark:bg-orange-400',
              )}
              style={{
                gridColumn: Math.floor(index / 7) + 2,
                gridRow: (index % 7) + 1,
              }}
              onClick={(event) => {
                event.stopPropagation();
                setSelected(day);
              }}
              onFocus={() => {
                setFocusedDay(day);
                setSelected(day);
              }}
              onKeyDown={(event) => {
                const offsets: Record<string, number> = {
                  ArrowLeft: -7,
                  ArrowRight: 7,
                  ArrowUp: -1,
                  ArrowDown: 1,
                };
                const offset = offsets[event.key];
                if (offset !== undefined) {
                  event.preventDefault();
                  cells.current
                    .get(Math.max(first, Math.min(today, day + offset)))
                    ?.focus();
                }
              }}
            />
          );
        })}
      </div>
      <div className="flex shrink-0 flex-wrap gap-x-3 text-[10px] leading-3 text-muted-foreground">
        <span className="flex items-center gap-1">
          <i className="size-2 rounded-[1px] bg-orange-600 dark:bg-orange-400" />
          No matching activity
        </span>
        <span className="flex items-center gap-1">
          <i className="size-2 rounded-[1px] bg-muted-foreground/25" />
          Recorded
        </span>
      </div>
    </div>
  );
}
