import { LngLatBounds } from 'maplibre-gl';
import type React from 'react';

import GeoJSONComponentOverlay from '~/components/map/geojson-component-overlay';

import mapCatalog from '../../shared/map-catalog.json';

type BaseMapCommon = {
  label: string;
  visible: boolean;
  attribution?: string;
};

type RasterBaseMapSetting = BaseMapCommon & {
  type: 'raster';
  url: string;
  tileSize: number;
};

/** A remote style-spec v8 URL that MapLibre can load directly. */
type VectorBaseMapSetting = BaseMapCommon & {
  type: 'vector';
  url: string;
};

/**
 * A style template from shared/map-styles/generated, loaded on demand by
 * `~/lib/map-style`. Templates that need MapTiler stay hidden until the web
 * key is configured.
 */
type TemplateBaseMapSetting = BaseMapCommon & {
  type: 'template';
  template: WebStyleTemplateId;
  requiresMapTilerKey: boolean;
};

export type BaseMapSetting =
  RasterBaseMapSetting | VectorBaseMapSetting | TemplateBaseMapSetting;

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

/**
 * iOS still renders the catalogue's `mapbox://` styles with the Mapbox SDK.
 * The web replaces those entries, under the same persisted and shared IDs,
 * with the MapLibre templates generated from shared/map-styles.
 */
export const webStyleTemplates = {
  mapboxStreet: { label: 'Street', requiresMapTilerKey: false },
  mapboxStreet3d: { label: 'Street 3D', requiresMapTilerKey: false },
  mapboxOutdoors: { label: 'Outdoors', requiresMapTilerKey: true },
  mapboxLight: { label: 'Light', requiresMapTilerKey: false },
  mapboxTopolight: { label: 'Topo Light', requiresMapTilerKey: false },
  mapboxDark: { label: 'Dark', requiresMapTilerKey: false },
  mapboxSatellite: { label: 'Satellite', requiresMapTilerKey: true },
} as const satisfies Partial<
  Record<keyof typeof mapCatalog.baseMaps, WebStyleTemplate>
>;

type WebStyleTemplate = { label: string; requiresMapTilerKey: boolean };
export type WebStyleTemplateId = keyof typeof webStyleTemplates;

const isWebStyleTemplateId = (id: string): id is WebStyleTemplateId =>
  id in webStyleTemplates;

export const mapTilerKey: string | undefined =
  process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim()
    ? process.env.NEXT_PUBLIC_MAPTILER_KEY.trim()
    : undefined;

export const baseMaps = Object.fromEntries(
  Object.entries(sharedBaseMapCatalog).map(([id, definition]) => [
    id,
    isWebStyleTemplateId(id)
      ? {
          label: webStyleTemplates[id].label,
          type: 'template' as const,
          template: id,
          requiresMapTilerKey: webStyleTemplates[id].requiresMapTilerKey,
          visible: definition.visible,
        }
      : definition.type === 'style'
        ? {
            label: definition.label,
            url: definition.url,
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

export type BaseMapId = keyof typeof baseMaps;

/** The base maps this deployment can render, in catalogue order. */
export const isBaseMapAvailable = (id: BaseMapId): boolean => {
  const setting = baseMaps[id];
  return (
    setting.type !== 'template' ||
    !setting.requiresMapTilerKey ||
    mapTilerKey !== undefined
  );
};

export const defaultBaseMap: BaseMapId = 'mapboxStreet';

/** A persisted or shared ID can name a map this deployment lacks. */
export const renderableBaseMap = (id: BaseMapId): BaseMapId =>
  id in baseMaps && isBaseMapAvailable(id) ? id : defaultBaseMap;

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
