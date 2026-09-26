'use client';

// Calendar heatmap for the activity calendar tile. Like the existing
// calendar tab it is drawn as plain SVG with d3 helpers, one cell per day,
// weeks as columns starting on Monday.

import { useState, type ReactNode } from 'react';
import * as d3 from 'd3';

import { categorySettings } from '~/settings/category';
import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { dayOf, mondayOf, type Sport } from '~/lib/stats/tile-data';
import { dateOfDay } from '~/lib/stats/tile-series';

import {
  formatWithUnit,
  monthName,
  shortDate,
  type TilePalette,
} from './format';

export type CalendarColour = 'sport' | Exclude<StatsMetric, 'count'>;

export function CalendarHeatmap({
  today,
  weeks,
  width,
  height,
  dominantSport,
  totals,
  colour,
  palette,
  labels,
}: {
  today: number;
  weeks: number;
  width: number;
  height: number;
  dominantSport: Map<number, Sport>;
  totals: Map<number, Record<StatsMetric, number>>;
  colour: CalendarColour;
  palette: TilePalette;
  labels: boolean;
}) {
  const left = labels ? 28 : 0;
  const top = labels ? 16 : 0;
  const cell = Math.max(
    3,
    Math.min(18, (width - left) / weeks, (height - top) / 7),
  );
  const gap = Math.max(1, Math.round(cell * 0.18));
  const firstWeek = mondayOf(today) - (weeks - 1) * 7;
  // The hovered day's label, drawn above its cell.
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const hoverProps = (x: number, y: number, text: string) => ({
    onPointerEnter: () => setHover({ x: x + (cell - gap) / 2, y, text }),
  });

  const values = [...totals.values()]
    .map((day) => (colour === 'sport' ? day.time : day[colour]))
    .sort(d3.ascending);
  const intensity = (value: number) =>
    values.length === 0 ? 1 : d3.bisectLeft(values, value) / values.length;

  const cells = [];
  const monthLabels = [];
  for (let week = 0; week < weeks; week++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const day = firstWeek + week * 7 + weekday;
      if (day > today) continue;
      const x = left + week * cell;
      const y = top + weekday * cell;
      const date = dateOfDay(day);
      if (labels && weekday === 0 && date.getUTCDate() <= 7) {
        monthLabels.push(
          <text key={`m${day}`} x={x} y={10} className="fill-muted-foreground">
            {monthName(date)}
          </text>,
        );
      }
      const dayTotals = totals.get(day);
      const sport = dominantSport.get(day);
      if (!dayTotals || !sport) {
        cells.push(
          <rect
            key={day}
            x={x}
            y={y}
            width={cell - gap}
            height={cell - gap}
            rx={cell > 8 ? 2 : 1}
            fill={palette.empty}
            {...hoverProps(x, y, `${shortDate(date)}: no activity`)}
          />,
        );
        continue;
      }
      const value = colour === 'sport' ? dayTotals.time : dayTotals[colour];
      cells.push(
        <rect
          key={day}
          x={x}
          y={y}
          width={cell - gap}
          height={cell - gap}
          rx={cell > 8 ? 2 : 1}
          fill={
            colour === 'sport' ? categorySettings[sport].color : palette.heat
          }
          fillOpacity={0.3 + 0.7 * intensity(value)}
          {...hoverProps(
            x,
            y,
            `${shortDate(date)}: ${categorySettings[sport].name}, ${
              colour === 'sport'
                ? formatWithUnit(dayTotals.time, 'time')
                : formatWithUnit(value, colour)
            }`,
          )}
        />,
      );
    }
  }

  const svgWidth = Math.min(width, left + cell * weeks);
  return (
    <div className="relative mx-auto" style={{ width: svgWidth }}>
      <svg
        width={svgWidth}
        height={top + cell * 7}
        role="img"
        aria-label="Activity calendar"
        className="block text-[10px]"
        onPointerLeave={() => setHover(null)}
      >
        {labels &&
          ['Mon', 'Wed', 'Fri'].map((label, index) => (
            <text
              key={label}
              x={0}
              y={top + cell * index * 2 + cell * 0.75}
              className="fill-muted-foreground"
            >
              {label}
            </text>
          ))}
        {monthLabels}
        {cells}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-1.5 py-0.5 text-[11px] text-popover-foreground shadow-sm"
          style={{ left: hover.x, top: hover.y - 4 }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}

// The tile face's calendar: one row per month (oldest at the top), one cell
// per day of the month, coloured by the day's dominant sport. Hovering a day
// names it in the footer, in place of the legend.
export function MonthRows({
  today,
  dominantSport,
  totals,
  palette,
  footer,
}: {
  today: number;
  dominantSport: Map<number, Sport>;
  totals: Map<number, Record<StatsMetric, number>>;
  palette: TilePalette;
  footer: ReactNode;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const date = dateOfDay(today);
  const months = Array.from({ length: 12 }, (_, index) => {
    const start = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 11 + index, 1),
    );
    const length = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return { start, first: dayOf(start), length };
  });

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col">
      <div
        className="grid min-h-0 flex-1 gap-[2px]"
        style={{ gridTemplateRows: 'repeat(12, minmax(0, 1fr))' }}
        onPointerLeave={() => setHover(null)}
      >
        {months.map((month) => (
          <div key={month.first} className="flex min-h-0 items-stretch gap-1">
            <span className="w-7 shrink-0 self-center text-[10px] leading-none text-muted-foreground">
              {monthName(month.start)}
            </span>
            <div
              className="grid min-w-0 flex-1 gap-[2px]"
              style={{ gridTemplateColumns: 'repeat(31, minmax(0, 1fr))' }}
            >
              {Array.from({ length: 31 }, (_, index) => {
                const day = month.first + index;
                if (index >= month.length || day > today)
                  return <i key={index} />;
                const sport = dominantSport.get(day);
                const dayTotals = totals.get(day);
                const label = `${shortDate(dateOfDay(day))}: ${
                  sport && dayTotals
                    ? `${categorySettings[sport].name}, ${formatWithUnit(dayTotals.time, 'time')}`
                    : 'rest day'
                }`;
                return (
                  <i
                    key={index}
                    className="block rounded-[2px]"
                    style={{
                      background: sport
                        ? categorySettings[sport].color
                        : palette.empty,
                    }}
                    onPointerEnter={() => setHover(label)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {hover ? (
        <div className="mt-1.5 h-4 shrink-0 truncate text-[11px] leading-4">
          {hover}
        </div>
      ) : (
        footer
      )}
    </div>
  );
}
