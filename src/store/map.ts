import { type LngLatBounds, type ViewState } from 'react-map-gl/maplibre';
import { type StateCreator } from 'zustand';

import type { PlaceFilter } from '~/lib/place-library';
import {
  baseMaps,
  defaultMapBounds,
  defaultMapPosition,
  overlayMaps,
} from '~/settings/map';

import { type RootState } from './index';

export type MapState = {
  baseMap: keyof typeof baseMaps;
  overlayMaps: (keyof typeof overlayMaps)[];
  position: ViewState;
  bbox: LngLatBounds;
  threeDim: boolean;
  showPhotos: boolean;
  showPlaces: boolean;
  routeFitRequest: { id: string; activityIDs: number[] } | null;
  placeFlyRequest: { id: string; latitude: number; longitude: number } | null;
  /** A place picked in header search: pinned on the map until the next pick,
   * without filtering anything (the place filter has its own pin). */
  searchPlace: PlaceFilter | null;
};

export type MapActions = {
  togglePhotos: () => void;
  togglePlaces: () => void;
  setBaseMap: (key: keyof typeof baseMaps) => void;
  toggleOverlayMap: (key: keyof typeof overlayMaps) => void;
  toggleThreeDim: () => void;
  setPosition: (position: ViewState, bbox: LngLatBounds) => void;
  hydrateMapState: (
    mapState: Partial<
      Pick<
        MapState,
        | 'baseMap'
        | 'overlayMaps'
        | 'position'
        | 'threeDim'
        | 'showPhotos'
        | 'showPlaces'
      >
    >,
  ) => void;
  requestRouteFit: (activityIDs: number[]) => void;
  completeRouteFit: (id: string) => void;
  requestPlaceFly: (latitude: number, longitude: number) => void;
  completePlaceFly: (id: string) => void;
  setSearchPlace: (place: PlaceFilter | null) => void;
};

export type MapSlice = MapState & MapActions;

export const createMapSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  MapSlice
> = (set) => ({
  // Initial state
  baseMap: (Object.entries(baseMaps).find(([, map]) => map.visible)?.[0] ??
    Object.keys(baseMaps)[0]) as keyof typeof baseMaps,
  overlayMaps: Object.entries(overlayMaps)
    .filter(([, map]) => map.visible)
    .map(([_key]) => _key as keyof typeof overlayMaps),
  position: defaultMapPosition,
  bbox: defaultMapBounds,
  threeDim: false,
  showPhotos: false,
  showPlaces: false,
  routeFitRequest: null,
  placeFlyRequest: null,
  searchPlace: null,

  // Actions
  requestRouteFit: (activityIDs) =>
    set((state) => {
      state.routeFitRequest = {
        id: crypto.randomUUID(),
        activityIDs: [...activityIDs],
      };
    }),
  completeRouteFit: (id) =>
    set((state) => {
      if (state.routeFitRequest?.id === id) state.routeFitRequest = null;
    }),
  requestPlaceFly: (latitude, longitude) =>
    set((state) => {
      state.placeFlyRequest = { id: crypto.randomUUID(), latitude, longitude };
    }),
  completePlaceFly: (id) =>
    set((state) => {
      if (state.placeFlyRequest?.id === id) state.placeFlyRequest = null;
    }),
  setSearchPlace: (place) =>
    set((state) => {
      state.searchPlace = place;
    }),
  togglePhotos: () =>
    set((state: RootState) => {
      state.showPhotos = !state.showPhotos;
    }),
  togglePlaces: () =>
    set((state) => {
      state.showPlaces = !state.showPlaces;
    }),

  setBaseMap: (key) =>
    set((state: RootState) => {
      state.baseMap = key;
    }),

  toggleOverlayMap: (key) =>
    set((state: RootState) => {
      if (state.overlayMaps.includes(key)) {
        state.overlayMaps = state.overlayMaps.filter(
          (item: keyof typeof overlayMaps) => item !== key,
        );
      } else {
        state.overlayMaps = [...state.overlayMaps, key];
      }
    }),

  setPosition: (position, bbox) =>
    set((state: RootState) => {
      state.position = position;
      state.bbox = bbox;
    }),

  hydrateMapState: (mapState) =>
    set((state: RootState) => {
      if (mapState.baseMap !== undefined) {
        state.baseMap = mapState.baseMap;
      }
      if (mapState.overlayMaps !== undefined) {
        state.overlayMaps = mapState.overlayMaps;
      }
      if (mapState.position !== undefined) {
        state.position = mapState.position;
      }
      if (mapState.threeDim !== undefined) {
        state.threeDim = mapState.threeDim;
      }
      if (mapState.showPhotos !== undefined) {
        state.showPhotos = mapState.showPhotos;
      }
      if (mapState.showPlaces !== undefined) {
        state.showPlaces = mapState.showPlaces;
      }
    }),

  toggleThreeDim: () =>
    set((state: RootState) => {
      state.threeDim = !state.threeDim;
    }),
});
