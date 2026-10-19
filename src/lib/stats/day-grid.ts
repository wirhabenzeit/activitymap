export type DayGridLayout = 'month-rows' | 'week-columns';
/** Arrow keys browse focus; Enter/Space retain native button activation. */
export function dayGridTarget(
  day: number,
  key: string,
  first: number,
  last: number,
  layout: DayGridLayout,
  rtl = false,
): number | null {
  const horizontal = layout === 'week-columns' ? 7 : 1;
  const vertical = layout === 'week-columns' ? 1 : 7;
  const offsets: Record<string, number> = {
    ArrowLeft: rtl ? horizontal : -horizontal,
    ArrowRight: rtl ? -horizontal : horizontal,
    ArrowUp: -vertical,
    ArrowDown: vertical,
  };
  if (key === 'Home') return first;
  if (key === 'End') return last;
  const offset = offsets[key];
  return offset === undefined
    ? null
    : Math.max(first, Math.min(last, day + offset));
}
export function selectedMonthDay(
  candidate: number | null,
  activeDays: readonly number[],
  first: number,
  last: number,
): number | null {
  if (candidate !== null && candidate >= first && candidate <= last)
    return candidate;
  return activeDays.filter((day) => day >= first && day <= last).at(-1) ?? null;
}
