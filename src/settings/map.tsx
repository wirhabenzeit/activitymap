import { LngLatBounds } from 'mapbox-gl';
import type React from 'react';
import GeoJSONComponentOverlay from '~/components/map/GeoJSONComponentOverlay';

// Base map types
type RasterBaseMapSetting = {
  url: string;
  type: 'raster';
  visible: boolean;
};

type VectorBaseMapSetting = {
  url: string;
  type: 'vector';
  visible: boolean;
};

type BaseMapSetting = RasterBaseMapSetting | VectorBaseMapSetting;

// Overlay types
type RasterOverlaySetting = {
  url: string;
  type: 'raster';
  visible: boolean;
  opacity?: number;
  interactiveLayerIds?: string[];
};

type ComponentOverlaySetting = {
  type: 'component';
  visible: boolean;
  component: React.ComponentType<Record<string, unknown>>;
  props?: Record<string, unknown>;
  interactiveLayerIds?: string[];
};

type OverlaySetting = RasterOverlaySetting | ComponentOverlaySetting;

// Combined type for backward compatibility
type MapSetting = {
  url?: string;
  type: 'raster' | 'vector' | 'component';
  visible: boolean;
  overlay: boolean;
  opacity?: number;
  component?: React.ComponentType<Record<string, unknown>>;
  props?: Record<string, unknown>;
};

// Export the settings
export const baseMaps: Record<string, BaseMapSetting> = {
  'Mapbox Street': {
    url: 'mapbox://styles/mapbox/streets-v12?optimize=true',
    type: 'vector',
    visible: true,
  },
  'Mapbox Street 3D': {
    url: 'mapbox://styles/wirhabenzeit/clk6y6c1q00lk01pe8fqs0urn',
    type: 'vector',
    visible: false,
  },
  'Mapbox Outdoors': {
    url: 'mapbox://styles/mapbox/outdoors-v12?optimize=true',
    type: 'vector',
    visible: false,
  },
  'Mapbox Light': {
    url: 'mapbox://styles/mapbox/light-v11?optimize=true',
    type: 'vector',
    visible: false,
  },
  'Mapbox Topolight': {
    url: 'mapbox://styles/wirhabenzeit/clk0tpduc00ab01qyguzi09gv',
    type: 'vector',
    visible: false,
  },
  'Mapbox Dark': {
    url: 'mapbox://styles/mapbox/dark-v11?optimize=true',
    type: 'vector',
    visible: false,
  },
  'Mapbox Satellite': {
    url: 'mapbox://styles/mapbox/satellite-v9?optimize=true',
    type: 'vector',
    visible: false,
  },
  'Swisstopo Vector Basemap': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json',
    type: 'vector',
    visible: false,
  },
  'Swisstopo Vector Light': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json',
    type: 'vector',
    visible: false,
  },
  'Swisstopo Vector Winter': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap-winter.vt/style.json',
    type: 'vector',
    visible: false,
  },
  'Swisstopo Satellite': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte-imagery.vt/style.json',
    type: 'vector',
    visible: false,
  },
  'Swisstopo Pixelkarte': {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`,
    type: 'raster',
    visible: false,
  },
  'Swisstopo Winter': {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`,
    type: 'raster',
    visible: false,
  },
  NorgesKart: {
    url: `https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png`,
    type: 'raster',
    visible: false,
  },
};

export const overlayMaps: Record<string, OverlaySetting> = {
  'Swisstopo Ski': {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`,
    type: 'raster',
    visible: false,
    opacity: 0.8,
  },
  'NVE Avalanche': {
    url: 'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}',
    type: 'raster',
    visible: false,
    opacity: 0.2,
  },
  'Swisstopo Slope': {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`,
    type: 'raster',
    visible: false,
    opacity: 0.4,
  },
  Veloland: {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png`,
    type: 'raster',
    visible: false,
    opacity: 0.4,
  },
  Wanderland: {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.wanderland/default/current/3857/{z}/{x}/{y}.png`,
    type: 'raster',
    visible: false,
    opacity: 0.4,
  },
  // Senja: {
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
};

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
