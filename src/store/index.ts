import { create, type StoreApi } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/shallow';

import { type StatsSlice, createStatsSlice } from './stats';
import { type ListSlice, createListSlice } from './list';
import { type SelectionSlice, createSelectionSlice } from './selection';
import { type MapSlice, createMapSlice } from './map';
import { type ActivitySlice, createActivitySlice } from './activity';
import { type FilterSlice, createFilterSlice } from './filter';

// Combine all slice types into the root state type
export type RootState = StatsSlice &
  ListSlice &
  SelectionSlice &
  MapSlice &
  ActivitySlice &
  FilterSlice;

// Create the store with all middlewares and slices
export const store = create<RootState>()(
  devtools(
    immer((set, get, store) => ({
      ...createStatsSlice(set, get, store),
      ...createListSlice(set, get, store),
      ...createSelectionSlice(set, get, store),
      ...createMapSlice(set, get, store),
      ...createActivitySlice(set, get, store),
      ...createFilterSlice(set, get, store),
    })),
    { name: 'Strava Store' },
  ),
);

export const useStore = store;

export const useShallowStore = Object.assign(
  <T>(selector: (state: RootState) => T) => useStore(useShallow(selector)),
  {
    subscribe: store.subscribe,
    getState: store.getState,
    setState: store.setState,
  },
);
