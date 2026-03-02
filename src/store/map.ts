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
  uploadedGeoJson: GeoJSON.FeatureCollection | null;
};

export type MapActions = {
  togglePhotos: () => void;
  setBaseMap: (key: keyof typeof baseMaps) => void;
  toggleOverlayMap: (key: keyof typeof overlayMaps) => void;
  toggleThreeDim: () => void;
  setPosition: (position: ViewState, bbox: LngLatBounds) => void;
  hydrateMapState: (
    mapState: Partial<
      Pick<MapState, 'baseMap' | 'overlayMaps' | 'position' | 'threeDim' | 'showPhotos'>
    >,
  ) => void;
  setUploadedGeoJson: (geoJson: GeoJSON.FeatureCollection | null) => void;
};

export type MapSlice = MapState & MapActions;

export const createMapSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  MapSlice
> = (set) => ({
  // Initial state
  baseMap:
    ((Object.entries(baseMaps).find(([, map]) => map.visible)?.[0] ??
      Object.keys(baseMaps)[0]) as keyof typeof baseMaps),
  overlayMaps: Object.entries(overlayMaps)
    .filter(([, map]) => map.visible)
    .map(([_key]) => _key as keyof typeof overlayMaps),
  position: defaultMapPosition,
  bbox: defaultMapBounds,
  threeDim: false,
  showPhotos: false,
  uploadedGeoJson: null,

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
    }),

  toggleThreeDim: () =>
    set((state: RootState) => {
      state.threeDim = !state.threeDim;
    }),

  setUploadedGeoJson: (geoJson) =>
    set((state: RootState) => {
      state.uploadedGeoJson = geoJson;
    }),
});
