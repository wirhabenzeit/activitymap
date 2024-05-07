import {type StateCreator} from "zustand";
import {type TotalZustand} from "./Zustand";

import {
  mapSettings,
  defaultMapPosition,
  defaultMapBounds,
} from "~/settings/map";
import type {
  ViewState,
  LngLatBoundsLike,
} from "react-map-gl";

export type MapZustand = {
  baseMap: keyof typeof mapSettings;
  overlayMaps: (keyof typeof mapSettings)[];
  position: ViewState;
  bbox: LngLatBoundsLike;
  threeDim: boolean;
  showPhotos: boolean;
  togglePhotos: () => void;
  setBaseMap: (key: keyof typeof mapSettings) => void;
  toggleOverlayMap: (key: keyof typeof mapSettings) => void;
  toggleThreeDim: () => void;
  setPosition: (
    position: ViewState,
    bbox: LngLatBoundsLike
  ) => void;
};

export const mapSlice: StateCreator<
  TotalZustand,
  [["zustand/immer", never]],
  [],
  MapZustand
> = (set) => ({
  baseMap: Object.entries(mapSettings).find(
    ([, map]) => map.visible && !map.overlay
  )[0],
  overlayMaps: Object.entries(mapSettings)
    .filter(([, map]) => map.visible && map.overlay)
    .map(([key]) => key),
  position: defaultMapPosition,
  bbox: defaultMapBounds,
  threeDim: false,
  showPhotos: false,
  togglePhotos: () =>
    set((state) => {
      state.showPhotos = !state.showPhotos;
    }),
  setBaseMap: (key) =>
    set((state) => {
      state.baseMap = key;
    }),
  toggleOverlayMap: (key) =>
    set((state) => {
      if (state.overlayMaps.includes(key))
        state.overlayMaps = state.overlayMaps.filter(
          (item) => item !== key
        );
      else state.overlayMaps = [...state.overlayMaps, key];
    }),
  setPosition: (position, bbox) =>
    set((state) => {
      state.position = position;
      state.bbox = bbox;
    }),
  toggleThreeDim: () =>
    set((state) => {
      state.threeDim = !state.threeDim;
    }),
});
