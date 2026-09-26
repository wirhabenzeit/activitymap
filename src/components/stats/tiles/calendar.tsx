'use client';

// Calendar heatmap for the activity calendar tile. Like the existing
// calendar tab it is drawn as plain SVG with d3 helpers, one cell per day,
// weeks as columns starting on Monday.

import * as d3 from 'd3';

import { categorySettings } from '~/settings/category';
import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { mondayOf, type Sport } from '~/lib/stats/tile-data';
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
        >
          <title>
            {`${shortDate(date)}: ${categorySettings[sport].name}, ${
              colour === 'sport'
                ? formatWithUnit(dayTotals.time, 'time')
                : formatWithUnit(value, colour)
            }`}
          </title>
        </rect>,
      );
    }
  }

  return (
    <svg
      width={Math.min(width, left + cell * weeks)}
      height={top + cell * 7}
      role="img"
      aria-label="Activity calendar"
      className="text-[10px]"
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
  );
}
