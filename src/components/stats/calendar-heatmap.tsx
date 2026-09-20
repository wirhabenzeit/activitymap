'use client';

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as d3 from 'd3';

import { useShallowStore } from '~/store';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { StatsContext } from '~/app/(app)/stats/[name]/StatsContext';
import { SelectFormElement } from './plot';
import calendarSettings, {
  settings,
  getter,
  setter,
  isTypeValueOption,
  type CalendarSetting,
  type CalendarSpec,
  type CalendarTypeValue,
} from './calendar-settings';
import { type Activity } from '~/server/db/schema';

type DayTotal = {
  date: Date;
  value: number | CalendarTypeValue;
  year: number;
  x: number;
  y: number;
};

type MonthBoundary = {
  date: Date;
  year: number;
  x: number;
  y: number;
};

const calendarCoordinates = (date: Date) => ({
  year: date.getUTCFullYear(),
  x: d3.utcMonday.count(d3.utcYear(date), date),
  y: (date.getUTCDay() + 6) % 7,
});

const dayOfMonthLabel = d3.utcFormat('%-d');
const monthLabel = d3.utcFormat('%b');
const yearLabel = d3.utcFormat('%Y');

const GAP = 3;
const MIN_STEP = 11;
const MAX_STEP = 22;
const LEFT_MARGIN = 42;
const RIGHT_MARGIN = 12;
const TOP_MARGIN = 20;
const YEAR_GAP = 24;
const WEEKS_PER_YEAR = 54;

function useCalendarData(activities: Activity[], setting: CalendarSetting) {
  return useMemo(() => {
    const { value } = getter(setting);

    const activitiesByDate = d3.group(activities, (activity) =>
      d3.utcDay(new Date(activity.start_date_local)),
    );

    const dayTotals: DayTotal[] = Array.from(
      d3.rollup(
        activities,
        (acts) => value.reduce(acts),
        (d) => d3.utcDay(new Date(d.start_date_local)),
      ),
      ([date, aggregated]) => ({
        date,
        value: aggregated,
        ...calendarCoordinates(date),
      }),
    );

    if (dayTotals.length === 0) return null;

    const start = d3.min(dayTotals, (d) => d.date);
    const maxDate = d3.max(dayTotals, (d) => d.date);
    if (!start || !maxDate) return null;
    const end = d3.utcDay.offset(maxDate, 1);

    const years = d3
      .utcYears(d3.utcYear(start), end)
      .map((date) => ({
        year: date.getUTCFullYear(),
        label: yearLabel(date),
      }))
      .reverse();

    const monthStarts = d3
      .utcMonths(d3.utcMonth(start), end)
      .map((date) => d3.utcMonday.ceil(date))
      .map((date) => ({
        ...calendarCoordinates(date),
        date,
        label: monthLabel(date),
      }));

    const monthBoundaries: MonthBoundary[] = d3
      .utcMonths(d3.utcMonth(start), end)
      .map((date) => ({
        ...calendarCoordinates(date),
        date,
      }));

    const dayNumbers = d3.utcDays(start, end).map((date) => ({
      ...calendarCoordinates(date),
      date,
      label: dayOfMonthLabel(date),
    }));

    return {
      value,
      activitiesByDate,
      dayTotals,
      years,
      monthStarts,
      monthBoundaries,
      dayNumbers,
    };
  }, [activities, setting]);
}

function CalendarLegend({
  value,
  numericDomain,
}: {
  value: CalendarSpec['value'];
  numericDomain: [number, number] | null;
}) {
  if (isTypeValueOption(value)) {
    const { domain, range } = value.colorDomain();
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {domain.map((key, i) => (
          <span key={key} className="flex items-center space-x-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: range[i] }}
            />
            <span>{value.format(key)}</span>
          </span>
        ))}
      </div>
    );
  }
  const [min, max] = numericDomain ?? [0, 1];
  const mid = (min + max) / 2;
  const scale = d3.scaleSequentialSqrt(d3.interpolateReds).domain([min, max]);
  // The scale is sqrt-transformed, so the color ramp moves fastest at the low
  // end of the domain — a plain min/max legend hides that. Splitting the bar
  // at the domain midpoint and labeling it shows where the color actually is.
  const gradient = (fromFrac: number, toFrac: number) =>
    d3
      .range(0, 1.0001, 1 / 10)
      .map((s) => {
        const frac = fromFrac + s * (toFrac - fromFrac);
        return `${scale(min + frac * (max - min))} ${(s * 100).toFixed(1)}%`;
      })
      .join(', ');
  return (
    <div className="flex items-center space-x-2 text-xs">
      <span className="font-semibold">{value.label}</span>
      <span className="tabular-nums">{value.format(min)}</span>
      <span
        className="inline-block h-2 w-12 rounded-l-sm"
        style={{ background: `linear-gradient(to right, ${gradient(0, 0.5)})` }}
      />
      <span className="tabular-nums text-muted-foreground">{value.format(mid)}</span>
      <span
        className="inline-block h-2 w-12 rounded-r-sm"
        style={{ background: `linear-gradient(to right, ${gradient(0.5, 1)})` }}
      />
      <span className="tabular-nums">{value.format(max)}</span>
    </div>
  );
}

export default function CalendarHeatmap() {
  const { settings: storedSettings, setSettings } = useShallowStore((state) => ({
    settings: state.settings,
    setSettings: state.setSettings,
  }));
  const setting = storedSettings.calendar;
  const { filteredActivities } = useFilteredActivities();
  const { settingsRef, width: containerWidth } = useContext(StatsContext);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const [tooltipContent, setTooltipContent] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const data = useCalendarData(filteredActivities, setting);

  const updateSetting = setter(setting);
  const applySetting = <K extends keyof CalendarSetting>(name: K, value: CalendarSetting[K]) => {
    setSettings((prev) => ({ ...prev, calendar: updateSetting(name, value) }));
  };

  useEffect(() => {
    setPortalTarget(settingsRef.current);
  }, [settingsRef]);

  if (!data) {
    return <div className="p-4 text-sm text-muted-foreground">No activities yet.</div>;
  }

  const { value, activitiesByDate, dayTotals, years, monthStarts, monthBoundaries, dayNumbers } =
    data;

  const numericDomain = isTypeValueOption(value)
    ? null
    : (d3.extent(dayTotals, (d) => d.value as number) as [number, number]);
  const colorScale = numericDomain
    ? d3.scaleSequentialSqrt(d3.interpolateReds).domain(numericDomain)
    : null;

  const resolveColor = (raw: number | CalendarTypeValue): string => {
    if (isTypeValueOption(value)) {
      const { domain, range } = value.colorDomain();
      const index = domain.indexOf(raw as CalendarTypeValue);
      return index >= 0 ? range[index]! : '#aaa';
    }
    return colorScale ? colorScale(raw as number) : '#aaa';
  };

  const availableWidth = Math.max(containerWidth - LEFT_MARGIN - RIGHT_MARGIN, 0);
  const step = Math.min(
    MAX_STEP,
    Math.max(MIN_STEP, availableWidth / WEEKS_PER_YEAR || MIN_STEP),
  );
  const cell = step - GAP;
  const width = WEEKS_PER_YEAR * step + LEFT_MARGIN;
  const yearHeight = 7 * step + YEAR_GAP;
  const height = years.length * yearHeight + TOP_MARGIN;

  const yearIndex = new Map(years.map((y, i) => [y.year, i]));
  const yOffset = (year: number) => (yearIndex.get(year) ?? 0) * yearHeight + TOP_MARGIN;

  const dayFontSize = Math.max(7, Math.min(10, cell * 0.6));

  const monthBoundaryPaths = monthBoundaries.map((b) => {
    const yBase = yOffset(b.year);
    // Centered in the gap on each side of the column, not on the cell edge itself,
    // so the stroke (centered on the path) doesn't bleed further into one
    // neighboring cell than the other.
    const leftGapX = LEFT_MARGIN + b.x * step - GAP / 2;
    const rightGapX = leftGapX + step;
    const y = yBase + b.y * step;
    const start =
      b.y > 1 ? `M${rightGapX},${yBase} V${y} h${-step}` : `M${leftGapX},${yBase}`;
    return `${start} V${yBase + 7 * step - GAP / 2}`;
  });

  return (
    <>
      <div ref={containerRef} className="relative h-full w-full overflow-auto">
        <svg width={width} height={height} className="block">
          {years.map((y) => (
            <text
              key={y.year}
              x={LEFT_MARGIN - 8}
              y={yOffset(y.year) + 4}
              textAnchor="end"
              fontWeight="bold"
              fontSize={11}
              fill="currentColor"
            >
              {y.label}
            </text>
          ))}
          {monthStarts.map((m, i) => (
            <text
              key={i}
              x={LEFT_MARGIN + m.x * step}
              y={yOffset(m.year) - 6}
              textAnchor="start"
              fontSize={10}
              fill="currentColor"
            >
              {m.label}
            </text>
          ))}
          {dayTotals.map((d, i) => {
            const x = LEFT_MARGIN + d.x * step;
            const y = yOffset(d.year) + d.y * step;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={cell}
                height={cell}
                rx={3}
                fill={resolveColor(d.value)}
                fillOpacity={0.85}
                onMouseEnter={(e) => {
                  const dayActivities = activitiesByDate.get(d.date) ?? [];
                  const details = dayActivities
                    .map((activity) => {
                      const formatted = isTypeValueOption(value)
                        ? value.format(value.fun(activity))
                        : value.format(value.fun(activity));
                      return `${activity.name}: ${formatted}`;
                    })
                    .join('\n');
                  const rect = containerRef.current?.getBoundingClientRect();
                  setTooltipContent({
                    x: e.clientX - (rect?.left ?? 0),
                    y: e.clientY - (rect?.top ?? 0),
                    text: `${d.date.toDateString()}\n\n${details}`,
                  });
                }}
                onMouseLeave={() => setTooltipContent(null)}
              />
            );
          })}
          {dayNumbers.map((d, i) => (
            <text
              key={i}
              x={LEFT_MARGIN + d.x * step + cell / 2}
              y={yOffset(d.year) + d.y * step + cell / 2 + dayFontSize / 3}
              textAnchor="middle"
              fontSize={dayFontSize}
              pointerEvents="none"
              fill="currentColor"
              opacity={0.6}
            >
              {d.label}
            </text>
          ))}
          {monthBoundaryPaths.map((path, i) => (
            <path
              key={i}
              d={path}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))}
        </svg>
        {tooltipContent && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs whitespace-pre-line rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md"
            style={{ left: tooltipContent.x + 12, top: tooltipContent.y + 12 }}
          >
            {tooltipContent.text}
          </div>
        )}
      </div>
      {portalTarget &&
        createPortal(
          <>
            <CalendarLegend value={value} numericDomain={numericDomain} />
            <SelectFormElement
              setting={settings.value}
              value={setting.value}
              setter={(fn) => applySetting('value', fn(setting.value) as CalendarSetting['value'])}
            />
          </>,
          portalTarget,
        )}
    </>
  );
}

export { calendarSettings };
