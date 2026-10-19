import type { PaginationState } from '@tanstack/react-table';
import { create } from 'zustand';

import type { HistoryRange } from '~/lib/stats/history';
import type { StatsTileID } from '~/settings/stats-tiles.generated';

export type BrowsingValues = {
  'list:pagination': PaginationState;
  'stats:options': Partial<Record<StatsTileID, string>>;
  'stats:calendarDay': number | null;
  'stats:monthDay': number | null;
  'stats:recordsPeriod': 'currentYear' | 'allTime';
  'stats:volumeGrouping': HistoryRange;
  'stats:comparison:year': number;
  'stats:comparison:month': number;
};
export type BrowsingKey = keyof BrowsingValues;
export type BrowsingScrollKey =
  | 'list:scroll'
  | 'stats:dashboard'
  | 'stats:calendarScroll'
  | `stats:focus:${StatsTileID}`;

// Session-only context: keys determine their value type; no activity payloads.
export const browsing = create<{
  values: Partial<BrowsingValues>;
  positions: Partial<Record<BrowsingScrollKey, { top: number; left: number }>>;
}>()(() => ({ values: {}, positions: {} }));

export function resetBrowsingContext() {
  browsing.setState({ values: {}, positions: {} });
}
