import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import { type ViewState, type LngLatBounds } from 'react-map-gl/mapbox';
import {
  mapSettings,
  defaultMapPosition,
  defaultMapBounds,
} from '~/settings/map';

export type MapState = {
  baseMap: keyof typeof mapSettings;
  overlayMaps: (keyof typeof mapSettings)[];
  position: ViewState;
  bbox: LngLatBounds;
  threeDim: boolean;
  showPhotos: boolean;
};

export type MapActions = {
  togglePhotos: () => void;
  setBaseMap: (key: keyof typeof mapSettings) => void;
  toggleOverlayMap: (key: keyof typeof mapSettings) => void;
  toggleThreeDim: () => void;
  setPosition: (position: ViewState, bbox: LngLatBounds) => void;
};

export type MapSlice = MapState & MapActions;

export const createMapSlice: StateCreator<
  RootState,
  [['zustand/immer', never]],
  [],
  MapSlice
> = (set) => ({
  // Initial state
  baseMap: Object.entries(mapSettings).find(
    ([, map]) => map.visible && !map.overlay,
  )![0],
  overlayMaps: Object.entries(mapSettings)
    .filter(([, map]) => map.visible && map.overlay)
    .map(([key]) => key),
  position: defaultMapPosition,
  bbox: defaultMapBounds,
  threeDim: false,
  showPhotos: false,

  // Actions
  togglePhotos: () =>
    set((state: RootState) => {
      state.showPhotos = !state.showPhotos;
    }),

  setBaseMap: (key) =>
    set((state: RootState) => {
      state.baseMap = key;
    }),

  toggleOverlayMap: (key) =>
    set((state: RootState) => {
      if (state.overlayMaps.includes(key)) {
        state.overlayMaps = state.overlayMaps.filter(
          (item: keyof typeof mapSettings) => item !== key,
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

  toggleThreeDim: () =>
    set((state: RootState) => {
      state.threeDim = !state.threeDim;
    }),
});
