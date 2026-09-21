import { LngLatBounds } from 'mapbox-gl';
import type React from 'react';

import mapCatalog from '../../shared/map-catalog.json';
import GeoJSONComponentOverlay from '~/components/map/geojson-component-overlay';

type BaseMapCommon = {
  label: string;
  url: string;
  visible: boolean;
  attribution?: string;
};

type RasterBaseMapSetting = BaseMapCommon & {
  type: 'raster';
  tileSize: number;
};

type VectorBaseMapSetting = BaseMapCommon & {
  type: 'vector';
};

export type BaseMapSetting = RasterBaseMapSetting | VectorBaseMapSetting;

type RasterOverlaySetting = {
  label: string;
  url: string;
  type: 'raster';
  visible: boolean;
  tileSize: number;
  opacity: number;
  attribution?: string;
  interactiveLayerIds?: string[];
};

type ComponentOverlaySetting = {
  label: string;
  type: 'component';
  visible: boolean;
  component: React.ComponentType<Record<string, unknown>>;
  props?: Record<string, unknown>;
  interactiveLayerIds?: string[];
};

export type OverlaySetting = RasterOverlaySetting | ComponentOverlaySetting;

type MapSetting = {
  label: string;
  url?: string;
  type: 'raster' | 'vector' | 'component';
  visible: boolean;
  overlay: boolean;
  tileSize?: number;
  opacity?: number;
  attribution?: string;
  component?: React.ComponentType<Record<string, unknown>>;
  props?: Record<string, unknown>;
};

type SharedBaseMapDefinition =
  | {
      label: string;
      type: 'style';
      url: string;
      visible: boolean;
      attribution?: string;
    }
  | {
      label: string;
      type: 'raster';
      url: string;
      visible: boolean;
      tileSize: number;
      attribution?: string;
    };

type SharedRasterOverlayDefinition = {
  label: string;
  url: string;
  tileSize: number;
  visible: boolean;
  opacity: number;
  attribution?: string;
};

type SharedBaseMapCatalog = {
  readonly [Key in keyof typeof mapCatalog.baseMaps]: SharedBaseMapDefinition;
};

type SharedRasterOverlayCatalog = {
  readonly [
    Key in keyof typeof mapCatalog.rasterOverlays
  ]: SharedRasterOverlayDefinition;
};

const sharedBaseMapCatalog = mapCatalog.baseMaps as SharedBaseMapCatalog;
const sharedRasterOverlayCatalog =
  mapCatalog.rasterOverlays as SharedRasterOverlayCatalog;

const webStyleURL = (url: string): string =>
  url.startsWith('mapbox://styles/mapbox/') ? `${url}?optimize=true` : url;

export const baseMaps = Object.fromEntries(
  Object.entries(sharedBaseMapCatalog).map(([id, definition]) => [
    id,
    definition.type === 'style'
      ? {
          label: definition.label,
          url: webStyleURL(definition.url),
          type: 'vector' as const,
          visible: definition.visible,
          ...(definition.attribution === undefined
            ? {}
            : { attribution: definition.attribution }),
        }
      : {
          label: definition.label,
          url: definition.url,
          type: 'raster' as const,
          visible: definition.visible,
          tileSize: definition.tileSize,
          ...(definition.attribution === undefined
            ? {}
            : { attribution: definition.attribution }),
        },
  ]),
) as {
  readonly [Key in keyof SharedBaseMapCatalog]: BaseMapSetting;
};

const sharedOverlayMaps = Object.fromEntries(
  Object.entries(sharedRasterOverlayCatalog).map(([id, definition]) => [
    id,
    {
      label: definition.label,
      url: definition.url,
      type: 'raster' as const,
      visible: definition.visible,
      tileSize: definition.tileSize,
      opacity: definition.opacity,
      ...(definition.attribution === undefined
        ? {}
        : { attribution: definition.attribution }),
    },
  ]),
) as {
  readonly [Key in keyof SharedRasterOverlayCatalog]: RasterOverlaySetting;
};

// Native layers are composed with the portable catalogue in each client.
// This layer relies on a React component and a web-bundled GeoJSON asset, so
// it deliberately does not appear in shared/map-catalog.json.
export const webNativeOverlayMaps = {
  friflytToppturer: {
    label: 'Friflyt Toppturer',
    type: 'component',
    visible: false,
    component: GeoJSONComponentOverlay,
    props: {
      id: 'friflyt-toppturer',
      data: '/friflyt/friflyt_enriched.geojson',
      color: '#0f766e',
      lineWidth: 1.6,
      opacity: 0.85,
      interactive: true,
    },
    interactiveLayerIds: ['friflyt-toppturer-line-layer'],
  },
} as const satisfies Record<string, ComponentOverlaySetting>;

export const overlayMaps = {
  ...webNativeOverlayMaps,
  ...sharedOverlayMaps,
} as const satisfies Record<string, OverlaySetting>;

export const mapSettings: Record<string, MapSetting> = {
  ...Object.entries(baseMaps).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: { ...value, overlay: false },
    }),
    {} as Record<string, MapSetting>,
  ),
  ...Object.entries(overlayMaps).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: { ...value, overlay: true },
    }),
    {} as Record<string, MapSetting>,
  ),
};

export const defaultMapPosition = {
  zoom: 7,
  longitude: 8.5,
  latitude: 46.8,
  pitch: 0,
  bearing: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
};

export const defaultMapBounds = new LngLatBounds([
  { lng: 5.3, lat: 45.9 },
  { lng: 11.1, lat: 47.8 },
]);
