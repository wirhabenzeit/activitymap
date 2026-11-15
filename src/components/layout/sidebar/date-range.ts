import { type DateFormat, formatPreferredDate } from '~/lib/date-preferences';
import {
  type CalendarDate,
  type DateRange,
  calendarDateFromLocalDate,
  calendarDateToLocalDate,
  isCalendarDate,
  normalizeDateRange,
} from '~/store/filter';

import { formatPreferredMonth } from './month-label';

// Date ranges are inclusive calendar days (YYYY-MM-DD) compared with an
// activity's own wall-clock day, so nothing here depends on a timezone: the
// arithmetic runs on calendar parts and never converts an instant.

export type DatePresetID =
  'this-year' | 'last-year' | 'this-month' | 'last-month' | 'last-12-months';

/** Same names and order as the native date presets (sentence case). */
export const DATE_PRESETS: readonly { id: DatePresetID; label: string }[] = [
  { id: 'this-year', label: 'This year' },
  { id: 'last-year', label: 'Last year' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-12-months', label: 'Last 12 months' },
];

const pad = (value: number, length = 2) => String(value).padStart(length, '0');
const calendarDate = (year: number, month: number, day: number) =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
/** `month` is 1-12. */
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const monthRange = (year: number, month: number): DateRange => ({
  start: calendarDate(year, month, 1),
  end: calendarDate(year, month, daysInMonth(year, month)),
});

const calendarParts = (value: CalendarDate) => {
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
};

/** The viewer's current calendar day. */
export const todayCalendarDate = (now: Date = new Date()): CalendarDate =>
  calendarDateFromLocalDate(now) ?? '1970-01-01';

/**
 * The inclusive range a preset covers on `today`. Calendar periods include
 * their future days; "Last 12 months" runs from the same day a year ago
 * (clamped for 29 February) through today.
 */
export function datePresetRange(
  preset: DatePresetID,
  today: CalendarDate,
): DateRange {
  const { year, month, day } = calendarParts(today);
  switch (preset) {
    case 'this-year':
      return {
        start: calendarDate(year, 1, 1),
        end: calendarDate(year, 12, 31),
      };
    case 'last-year':
      return {
        start: calendarDate(year - 1, 1, 1),
        end: calendarDate(year - 1, 12, 31),
      };
    case 'this-month':
      return monthRange(year, month);
    case 'last-month':
      return month === 1
        ? monthRange(year - 1, 12)
        : monthRange(year, month - 1);
    case 'last-12-months':
      return {
        start: calendarDate(
          year - 1,
          month,
          Math.min(day, daysInMonth(year - 1, month)),
        ),
        end: today,
      };
  }
}

/** The preset a range equals today, to mark it as the active choice. */
export function activeDatePreset(
  range: DateRange | undefined,
  today: CalendarDate,
): DatePresetID | undefined {
  if (!range) return undefined;
  return DATE_PRESETS.find(({ id }) => {
    const candidate = datePresetRange(id, today);
    return candidate.start === range.start && candidate.end === range.end;
  })?.id;
}

export type DayRangeInput =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'valid'; range: DateRange };

/** Validate the From / Through fields (inclusive end, end on or after start). */
export function parseDayRangeInput(
  from: string,
  through: string,
): DayRangeInput {
  if (!from.trim() && !through.trim()) return { status: 'empty' };
  if (!isCalendarDate(from) || !isCalendarDate(through)) {
    return { status: 'invalid' };
  }
  const range = normalizeDateRange(from, through);
  return range ? { status: 'valid', range } : { status: 'invalid' };
}

/** A whole number of calendar months, which reads better as "Mar 2025". */
const isWholeMonths = (range: DateRange) => {
  const start = calendarParts(range.start);
  const end = calendarParts(range.end);
  return start.day === 1 && end.day === daysInMonth(end.year, end.month);
};

const formatDay = (value: CalendarDate, format: DateFormat, locale?: string) =>
  formatPreferredDate(`${value}T00:00:00Z`, format, locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/** "Mar 2025 – Jun 2025" for whole months, otherwise the days themselves. */
export function formatDateRangeLabel(
  range: DateRange,
  format: DateFormat = 'system',
  locale?: string,
): string {
  const wholeMonths = isWholeMonths(range);
  const label = (value: CalendarDate) => {
    const local = calendarDateToLocalDate(value);
    return wholeMonths && local
      ? formatPreferredMonth(local, format, locale)
      : formatDay(value, format, locale);
  };
  const start = label(range.start);
  const end = label(range.end);
  return start === end ? start : `${start} – ${end}`;
}
