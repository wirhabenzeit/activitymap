export type DateFormat = 'system' | 'day-first' | 'month-first' | 'iso';
export const dateFormatOptions: { value: DateFormat; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'day-first', label: 'Day first (31.12.2026)' },
  { value: 'month-first', label: 'Month first (12/31/2026)' },
  { value: 'iso', label: 'ISO (2026-12-31)' },
];

const DATE_FIELDS = ['weekday', 'year', 'month', 'day', 'dateStyle'] as const;
const systemFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `toLocaleDateString` builds a new `Intl.DateTimeFormat` on every call, which
 * dominated rendering Stats (one label per calendar day) and the List. Reuse
 * one per locale and options; the result is identical.
 */
function systemDateFormatter(
  locale: Intl.LocalesArgument,
  options: Intl.DateTimeFormatOptions | undefined,
): Intl.DateTimeFormat {
  const localeKey =
    locale instanceof Intl.Locale
      ? locale.toString()
      : Array.isArray(locale)
        ? locale.map(String)
        : locale;
  const key = JSON.stringify([localeKey, options]);
  let formatter = systemFormatters.get(key);
  if (!formatter) {
    // Like toLocaleDateString: without any date field, show the full date.
    const hasDateField = DATE_FIELDS.some((field) => options?.[field]);
    formatter = new Intl.DateTimeFormat(locale, {
      ...(!hasDateField && {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }),
      ...options,
      timeZone: 'UTC',
    });
    systemFormatters.set(key, formatter);
  }
  return formatter;
}

/** Dates represent activity-local wall time encoded as UTC; never shift the day. */
export function formatPreferredDate(
  value: Date | string,
  format: DateFormat = 'system',
  locale?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  if (format === 'system')
    return systemDateFormatter(locale, options).format(date);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (format === 'day-first') return `${day}.${month}.${year}`;
  if (format === 'month-first') return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}
