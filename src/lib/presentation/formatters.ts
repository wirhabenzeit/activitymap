import { formattingLocale } from './messages';

// Immutable formatter instances are safe to share. Bound these caches because a
// formatter can also be called with a locale supplied by a fixture or consumer.
const numbers = new Map<string, Intl.NumberFormat>();
const dates = new Map<string, Intl.DateTimeFormat>();
function cached<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const found = cache.get(key);
  if (found) return found;
  if (cache.size >= 24) cache.clear();
  const formatter = create();
  cache.set(key, formatter);
  return formatter;
}
export function numberFormatter(
  locale = 'en',
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const resolved = formattingLocale(locale);
  return cached(
    numbers,
    JSON.stringify([resolved, options]),
    () => new Intl.NumberFormat(resolved, options),
  );
}
export function dateFormatter(
  locale = 'en',
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  const resolved = formattingLocale(locale);
  return cached(
    dates,
    JSON.stringify([resolved, options]),
    () => new Intl.DateTimeFormat(resolved, options),
  );
}
