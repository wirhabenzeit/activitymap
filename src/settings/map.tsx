import { LngLatBounds } from 'mapbox-gl';
import type React from 'react';
import GeoJSONComponentOverlay from '~/components/map/geojson-component-overlay';

// Base map types
type RasterBaseMapSetting = {
  label: string;
  url: string;
  type: 'raster';
  visible: boolean;
};

type VectorBaseMapSetting = {
  label: string;
  url: string;
  type: 'vector';
  visible: boolean;
};

export type BaseMapSetting = RasterBaseMapSetting | VectorBaseMapSetting;

// Overlay types
type RasterOverlaySetting = {
  label: string;
  url: string;
  type: 'raster';
  visible: boolean;
  opacity?: number;
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

// Combined type for backward compatibility
type MapSetting = {
  label: string;
  url?: string;
  type: 'raster' | 'vector' | 'component';
  visible: boolean;
  overlay: boolean;
  opacity?: number;
  component?: React.ComponentType<Record<string, unknown>>;
  props?: Record<string, unknown>;
};

export const baseMaps = {
  mapboxStreet: {
    label: 'Mapbox Street',
    url: 'mapbox://styles/mapbox/streets-v12?optimize=true',
    type: 'vector',
    visible: true,
  },
  mapboxStreet3d: {
    label: 'Mapbox Street 3D',
    url: 'mapbox://styles/wirhabenzeit/clk6y6c1q00lk01pe8fqs0urn',
    type: 'vector',
    visible: false,
  },
  mapboxOutdoors: {
    label: 'Mapbox Outdoors',
    url: 'mapbox://styles/mapbox/outdoors-v12?optimize=true',
    type: 'vector',
    visible: false,
  },
  mapboxLight: {
    label: 'Mapbox Light',
    url: 'mapbox://styles/mapbox/light-v11?optimize=true',
    type: 'vector',
    visible: false,
  },
  mapboxTopolight: {
    label: 'Mapbox Topolight',
    url: 'mapbox://styles/wirhabenzeit/clk0tpduc00ab01qyguzi09gv',
    type: 'vector',
    visible: false,
  },
  mapboxDark: {
    label: 'Mapbox Dark',
    url: 'mapbox://styles/mapbox/dark-v11?optimize=true',
    type: 'vector',
    visible: false,
  },
  mapboxSatellite: {
    label: 'Mapbox Satellite',
    url: 'mapbox://styles/mapbox/satellite-v9?optimize=true',
    type: 'vector',
    visible: false,
  },
  swisstopoVectorBasemap: {
    label: 'Swisstopo Vector Basemap',
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json',
    type: 'vector',
    visible: false,
  },
  swisstopoVectorLight: {
    label: 'Swisstopo Vector Light',
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json',
    type: 'vector',
    visible: false,
  },
  swisstopoVectorWinter: {
    label: 'Swisstopo Vector Winter',
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap-winter.vt/style.json',
    type: 'vector',
    visible: false,
  },
  swisstopoSatellite: {
    label: 'Swisstopo Satellite',
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte-imagery.vt/style.json',
    type: 'vector',
    visible: false,
  },
  swisstopoPixelkarte: {
    label: 'Swisstopo Pixelkarte',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
    type: 'raster',
    visible: false,
  },
  swisstopoWinter: {
    label: 'Swisstopo Winter',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg',
    type: 'raster',
    visible: false,
  },
  norgeskart: {
    label: 'NorgesKart',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
    type: 'raster',
    visible: false,
  },
} as const satisfies Record<string, BaseMapSetting>;

export const overlayMaps = {
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
  swisstopoSki: {
    label: 'Swisstopo Ski',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png',
    type: 'raster',
    visible: false,
    opacity: 0.8,
  },
  nveAvalanche: {
    label: 'NVE Avalanche',
    url: 'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}',
    type: 'raster',
    visible: false,
    opacity: 0.2,
  },
  swisstopoSlope: {
    label: 'Swisstopo Slope',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png',
    type: 'raster',
    visible: false,
    opacity: 0.4,
  },
  veloland: {
    label: 'Veloland',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png',
    type: 'raster',
    visible: false,
    opacity: 0.4,
  },
  wanderland: {
    label: 'Wanderland',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.astra.wanderland/default/current/3857/{z}/{x}/{y}.png',
    type: 'raster',
    visible: false,
    opacity: 0.4,
  },
  // senja: {
  //   label: 'Senja',
  //   type: 'component',
  //   visible: false,
  //   component: GeoJSONComponentOverlay,
  //   props: {
  //     id: 'senja-geojson',
  //     data: '/senja.geojson',
  //     color: '#ff0000',
  //     lineWidth: 2,
  //     opacity: 0.8,
  //     interactive: true,
  //   },
  //   interactiveLayerIds: ['senja-geojson-line-layer'],
  // },
} as const satisfies Record<string, OverlaySetting>;

// For backward compatibility, export a combined mapSettings object
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
