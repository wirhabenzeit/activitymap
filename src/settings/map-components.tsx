'no memo';
'use client';

import React from 'react';
// Map components
import { RasterMap } from '~/components/map/raster-map';

/**
 * Map type definitions
 */
export type MapType = 'vector' | 'raster';

export interface VectorMapConfig {
  type: 'vector';
  url: string;
}

export interface RasterMapConfig {
  type: 'raster';
  render: () => React.ReactNode;
}

export type BaseMapConfig = VectorMapConfig | RasterMapConfig;

/**
 * Base maps configuration
 * These are mutually exclusive - only one can be active at a time
 */
export const baseMaps: Record<string, BaseMapConfig> = {
  'Mapbox Street': {
    url: 'mapbox://styles/mapbox/streets-v12?optimize=true',
    type: 'vector',
  },
  'Mapbox Street 3D': {
    url: 'mapbox://styles/wirhabenzeit/clk6y6c1q00lk01pe8fqs0urn',
    type: 'vector',
  },
  'Mapbox Outdoors': {
    url: 'mapbox://styles/mapbox/outdoors-v12?optimize=true',
    type: 'vector',
  },
  'Mapbox Light': {
    url: 'mapbox://styles/mapbox/light-v11?optimize=true',
    type: 'vector',
  },
  'Mapbox Topolight': {
    url: 'mapbox://styles/wirhabenzeit/clk0tpduc00ab01qyguzi09gv',
    type: 'vector',
  },
  'Mapbox Dark': {
    url: 'mapbox://styles/mapbox/dark-v11?optimize=true',
    type: 'vector',
  },
  'Mapbox Satellite': {
    url: 'mapbox://styles/mapbox/satellite-v9?optimize=true',
    type: 'vector',
  },
  'Swisstopo Vector Basemap': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json',
    type: 'vector',
  },
  'Swisstopo Vector Light': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json',
    type: 'vector',
  },
  'Swisstopo Vector Winter': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap-winter.vt/style.json',
    type: 'vector',
  },
  'Swisstopo Satellite': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte-imagery.vt/style.json',
    type: 'vector',
  },
  'Swisstopo Pixelkarte': {
    type: 'raster',
    render: () => (
      <RasterMap
        id="Swisstopo Pixelkarte"
        url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg"
        tileSize={128}
      />
    ),
  },
  'Swisstopo Winter': {
    type: 'raster',
    render: () => (
      <RasterMap
        id="Swisstopo Winter"
        url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg"
        tileSize={128}
      />
    ),
  },
  NorgesKart: {
    type: 'raster',
    render: () => (
      <RasterMap
        id="NorgesKart"
        url="https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png"
        tileSize={128}
      />
    ),
  },
};

import SkiOverlay from '../components/map/SkiOverlay';
import GeoJSONOverlay from '../components/map/GeoJSONOverlay';

export const overlayMaps: Record<string, BaseMapConfig> = {
  'Swisstopo Ski': {
    type: 'raster',
    render: () => <SkiOverlay />,
  },
  'GeoJSON Tracks': {
    type: 'raster',
    render: () => <GeoJSONOverlay url="/geojson/tracks.geojson" layerId="geojson-layer" lineColor="#FF4500" lineWidth={3} />,
  },
  'Swisstopo Slope': {
    type: 'raster',
    render: () => (
      <RasterMap
        id="Swisstopo Slope"
        url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png"
        opacity={0.4}
      />
    ),
  },
  Veloland: {
    type: 'raster',
    render: () => (
      <RasterMap
        id="Veloland"
        url="https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png"
        opacity={0.4}
      />
    ),
  },
  Wanderland: {
    type: 'raster',
    render: () => (
      <RasterMap
        id="Wanderland"
        url="https://wmts.geo.admin.ch/1.0.0/ch.astra.wanderland/default/current/3857/{z}/{x}/{y}.png"
        opacity={0.4}
      />
    ),
  },
};

// Example of how to add an interactive layer
// 'Interactive Layer Example': {
//   type: 'raster',
//   interactiveLayerIds: ['interactive-layer-id'],
//   render: () => (
//     <RasterMap
//       id="Interactive Layer Example"
//       url="https://example.com/tiles/{z}/{x}/{y}.png"
//       opacity={0.7}
//     />
//   ),
// },
