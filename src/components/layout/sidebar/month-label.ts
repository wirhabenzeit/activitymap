import type { DateFormat } from '~/lib/date-preferences';

/** A month in the user's date-format preference. The date carries local
 * calendar parts (as the date pickers produce them), never an instant. */
export function formatPreferredMonth(
  date: Date,
  format: DateFormat = 'system',
  locale?: string,
): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  if (format === 'day-first') return `${month}.${year}`;
  if (format === 'month-first') return `${month}/${year}`;
  if (format === 'iso') return `${year}-${month}`;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
  }).format(date);
}
