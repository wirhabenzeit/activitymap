'use client';

// The activity calendar tile's grid: one row per month, one cell per day.

import { useState, type ReactNode } from 'react';

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
  const months = calendarMonths(today);

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
