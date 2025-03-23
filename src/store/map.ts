import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import { type ViewState, type LngLatBounds } from 'react-map-gl/mapbox';
import {
  baseMaps,
  overlayMaps,
  defaultMapPosition,
  defaultMapBounds,
} from '~/settings/map';

export type MapState = {
  baseMap: keyof typeof baseMaps;
  overlayMaps: (keyof typeof overlayMaps)[];
  position: ViewState;
  bbox: LngLatBounds;
  threeDim: boolean;
  showPhotos: boolean;
};

export type MapActions = {
  togglePhotos: () => void;
  setBaseMap: (key: keyof typeof baseMaps) => void;
  toggleOverlayMap: (key: keyof typeof overlayMaps) => void;
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
  baseMap: Object.entries(baseMaps).find(
    ([, map]) => map.visible
  )![0],
  overlayMaps: Object.entries(overlayMaps)
    .filter(([, map]) => map.visible)
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

  toggleThreeDim: () =>
    set((state: RootState) => {
      state.threeDim = !state.threeDim;
    }),
});
