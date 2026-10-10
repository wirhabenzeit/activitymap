/** Match iOS AppShell.sidebarAvailable, measured after the filter sidebar. */
export const ACTIVITY_PANEL_MIN_WIDTH = 760;
export type DetailPresentation = 'panel' | 'push';

export function detailPresentation(contentWidth: number): DetailPresentation {
  return contentWidth < ACTIVITY_PANEL_MIN_WIDTH ? 'push' : 'panel';
}

export function inspectedActivity(search: string) {
  const value = new URLSearchParams(search).get('activity');
  return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : 0;
}

export function activityURL(url: string, id: number) {
  const next = new URL(url);
  if (id) next.searchParams.set('activity', String(id));
  // URLSearchParams is unrelated to a database delete.
  // eslint-disable-next-line drizzle/enforce-delete-with-where
  else next.searchParams.delete('activity');
  return `${next.pathname}${next.search}${next.hash}`;
}

/** The caller supplies the filtered, sorted row model before pagination. */
export function inspectionStep<T extends { id: string }>(
  rows: T[],
  activeId: number,
  direction: -1 | 1,
  pageSize: number,
) {
  const current = rows.findIndex((row) => Number(row.id) === activeId);
  const index = current + direction;
  if (current < 0 || index < 0 || index >= rows.length) return;
  return { row: rows[index]!, pageIndex: Math.floor(index / pageSize) };
}
