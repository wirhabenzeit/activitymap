// `start_date_local` is a wall-clock time in the activity's own timezone,
// stored as if it were UTC (e.g. `2026-09-22T12:06:27Z` means 12:06 where the
// activity happened). Format it in UTC so the viewer's timezone never shifts it.
// See #274.

type LocalDateTimeValue = Date | string;

const toDate = (value: LocalDateTimeValue) =>
  value instanceof Date ? value : new Date(value);

export const formatLocalDate = (
  value: LocalDateTimeValue,
  options?: Intl.DateTimeFormatOptions,
  locale?: Intl.LocalesArgument,
) => toDate(value).toLocaleDateString(locale, { ...options, timeZone: 'UTC' });

export const formatLocalTime = (
  value: LocalDateTimeValue,
  options?: Intl.DateTimeFormatOptions,
  locale?: Intl.LocalesArgument,
) => toDate(value).toLocaleTimeString(locale, { ...options, timeZone: 'UTC' });

export const formatLocalDateTime = (
  value: LocalDateTimeValue,
  options?: Intl.DateTimeFormatOptions,
  locale?: Intl.LocalesArgument,
) => toDate(value).toLocaleString(locale, { ...options, timeZone: 'UTC' });
