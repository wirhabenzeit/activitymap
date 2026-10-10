import { type StatsTileID } from '~/settings/stats-tiles.generated';

// Public URL names stay independent of the shared calculation IDs.
export const focusTiles = {
  'training-volume': 'weeklyVolume',
  'this-month': 'monthVsLastMonth',
  'year-to-date': 'yearToDate',
  records: 'records',
  'activity-calendar': 'activityCalendar',
  'sport-mix': 'sportMix',
  hilliness: 'distanceVsElevation',
} as const satisfies Record<string, StatsTileID>;

export function focusedTile(search: string): StatsTileID | null {
  const name = new URLSearchParams(search).get('tile');
  return name && Object.hasOwn(focusTiles, name)
    ? focusTiles[name as keyof typeof focusTiles]
    : null;
}

export function tileFocusURL(href: string, id: StatsTileID | null): string {
  const url = new URL(href);
  // Activity inspection belongs to its originating focus surface.
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- URL parameter.
  url.searchParams.delete('activity');
  const name = Object.entries(focusTiles).find(([, tile]) => tile === id)?.[0];
  if (name) url.searchParams.set('tile', name);
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- URL parameters, not database rows.
  else url.searchParams.delete('tile');
  return `${url.pathname}${url.search}${url.hash}`;
}
