import { create } from 'zustand';
import {
  devtools,
  persist,
  createJSONStorage,
  type StateStorage,
} from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/shallow';

import { type StatsSlice, createStatsSlice } from './stats';
import { type ListSlice, createListSlice } from './list';
import { type SelectionSlice, createSelectionSlice } from './selection';
import { type MapSlice, createMapSlice } from './map';
import { type ActivitySlice, createActivitySlice } from './activity';
import { type FilterSlice, createFilterSlice } from './filter';
import { type AuthSlice, createAuthSlice } from './auth';
import {
  type NotificationSlice,
  createNotificationSlice,
} from './notifications';
import {
  baseMaps,
  overlayMaps,
  defaultMapPosition,
} from '~/settings/map';

// Combine all slice types into the root state type
export type RootState = StatsSlice &
  ListSlice &
  SelectionSlice &
  MapSlice &
  ActivitySlice &
  FilterSlice &
  AuthSlice &
  NotificationSlice;

type PersistedUiState = Pick<
  RootState,
  | 'baseMap'
  | 'overlayMaps'
  | 'position'
  | 'threeDim'
  | 'showPhotos'
  | 'sportType'
  | 'sportGroup'
  | 'dateRange'
  | 'values'
  | 'search'
  | 'binary'
>;

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const sanitizeDateRange = (value: unknown): RootState['dateRange'] => {
  if (!isRecord(value)) {
    return undefined;
  }

  const start = new Date(value.start as string | number | Date);
  const end = new Date(value.end as string | number | Date);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return undefined;
  }

  return { start, end };
};

const sanitizePosition = (value: unknown): RootState['position'] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const longitude = value.longitude;
  const latitude = value.latitude;
  const zoom = value.zoom;
  if (
    !isFiniteNumber(longitude) ||
    !isFiniteNumber(latitude) ||
    !isFiniteNumber(zoom)
  ) {
    return undefined;
  }

  const bearing = isFiniteNumber(value.bearing)
    ? value.bearing
    : defaultMapPosition.bearing;
  const pitch = isFiniteNumber(value.pitch)
    ? value.pitch
    : defaultMapPosition.pitch;

  const paddingValue = value.padding;
  const padding =
    isRecord(paddingValue) &&
    isFiniteNumber(paddingValue.top) &&
    isFiniteNumber(paddingValue.right) &&
    isFiniteNumber(paddingValue.bottom) &&
    isFiniteNumber(paddingValue.left)
      ? {
        top: paddingValue.top,
        right: paddingValue.right,
        bottom: paddingValue.bottom,
        left: paddingValue.left,
      }
      : defaultMapPosition.padding;

  return {
    longitude,
    latitude,
    zoom,
    bearing,
    pitch,
    padding,
  };
};

// Create the store with all middlewares and slices
export const store = create<RootState>()(
  devtools(
    persist(
      immer((set, get, store) => ({
        ...createStatsSlice(set, get, store),
        ...createListSlice(set, get, store),
        ...createSelectionSlice(set, get, store),
        ...createMapSlice(set, get, store),
        ...createActivitySlice(set, get, store),
        ...createFilterSlice(set, get, store),
        ...createAuthSlice(set, get, store),
        ...createNotificationSlice(set, get, store),
      })),
      {
        name: 'activitymap-ui-state',
        version: 1,
        storage: createJSONStorage(() =>
          typeof window === 'undefined' ? noopStorage : window.localStorage,
        ),
        partialize: (state): PersistedUiState => ({
          baseMap: state.baseMap,
          overlayMaps: state.overlayMaps,
          position: state.position,
          threeDim: state.threeDim,
          showPhotos: state.showPhotos,
          sportType: state.sportType,
          sportGroup: state.sportGroup,
          dateRange: state.dateRange,
          values: state.values,
          search: state.search,
          binary: state.binary,
        }),
        merge: (persistedState, currentState) => {
          const persisted = (persistedState ?? {}) as Partial<PersistedUiState>;

          const baseMap =
            typeof persisted.baseMap === 'string' && persisted.baseMap in baseMaps
              ? persisted.baseMap
              : currentState.baseMap;

          const overlayMapsState = Array.isArray(persisted.overlayMaps)
            ? persisted.overlayMaps.filter(
              (overlay): overlay is keyof typeof overlayMaps =>
                typeof overlay === 'string' && overlay in overlayMaps,
            )
            : currentState.overlayMaps;

          return {
            ...currentState,
            baseMap,
            overlayMaps: overlayMapsState,
            position: sanitizePosition(persisted.position) ?? currentState.position,
            threeDim:
              typeof persisted.threeDim === 'boolean'
                ? persisted.threeDim
                : currentState.threeDim,
            showPhotos:
              typeof persisted.showPhotos === 'boolean'
                ? persisted.showPhotos
                : currentState.showPhotos,
            sportType: {
              ...currentState.sportType,
              ...(isRecord(persisted.sportType)
                ? persisted.sportType
                : {}),
            },
            sportGroup: {
              ...currentState.sportGroup,
              ...(isRecord(persisted.sportGroup)
                ? persisted.sportGroup
                : {}),
            },
            dateRange: sanitizeDateRange(persisted.dateRange),
            values: {
              ...currentState.values,
              ...(isRecord(persisted.values) ? persisted.values : {}),
            },
            search:
              typeof persisted.search === 'string'
                ? persisted.search
                : currentState.search,
            binary: {
              ...currentState.binary,
              ...(isRecord(persisted.binary) ? persisted.binary : {}),
            },
          };
        },
      },
    ),
    { name: 'Strava Store' },
  ),
);

export const useStore = store;

export const useShallowStore = Object.assign(
  <T>(selector: (state: RootState) => T) => useStore(useShallow(selector)),
  {
    subscribe: (...args: Parameters<typeof store.subscribe>) => store.subscribe(...args),
    getState: () => store.getState(),
    setState: (...args: Parameters<typeof store.setState>) => store.setState(...args),
  },
);
