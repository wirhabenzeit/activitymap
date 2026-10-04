export type DateFormat = 'system' | 'day-first' | 'month-first' | 'iso';
export const dateFormatOptions: { value: DateFormat; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'day-first', label: 'Day first (31.12.2026)' },
  { value: 'month-first', label: 'Month first (12/31/2026)' },
  { value: 'iso', label: 'ISO (2026-12-31)' },
];

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
    return date.toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (format === 'day-first') return `${day}.${month}.${year}`;
  if (format === 'month-first') return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}
