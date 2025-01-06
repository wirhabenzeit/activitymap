import { LayerSAC } from '~/components/map/LayerSAC';
import { LayerFriflyt } from '~/components/map/LayerFriflyt';
import { LayerQuaeldich } from '~/components/map/LayerQuaeldich';
import { LngLatBounds } from 'mapbox-gl';
import type { RefObject } from 'react';
import type { MapRef } from 'react-map-gl';

type RasterMapSetting = {
  url: string;
  type: 'raster';
  visible: boolean;
  opacity?: number;
  overlay: boolean;
};

type VectorMapSetting = {
  url: string;
  type: 'vector';
  visible: boolean;
  overlay: false;
};

export type CustomLayerProps = {
  mapRef: RefObject<MapRef | null>;
};

type CustomMapSetting = {
  type: 'custom';
  visible: boolean;
  overlay: true;
  component: React.FC<CustomLayerProps>;
};

type MapSetting = RasterMapSetting | VectorMapSetting | CustomMapSetting;

export const mapSettings: Record<string, MapSetting> = {
  'Mapbox Street': {
    url: 'mapbox://styles/mapbox/streets-v12?optimize=true',
    type: 'vector',
    visible: true,
    overlay: false,
  },
  'Mapbox Street 3D': {
    url: 'mapbox://styles/wirhabenzeit/clk6y6c1q00lk01pe8fqs0urn',
    type: 'vector',
    visible: false,
    overlay: false,
  },
  'Mapbox Outdoors': {
    url: 'mapbox://styles/mapbox/outdoors-v12?optimize=true',
    type: 'vector',
    visible: false,
    overlay: false,
  },
  'Mapbox Light': {
    url: 'mapbox://styles/mapbox/light-v11?optimize=true',
    type: 'vector',
    visible: false,
    overlay: false,
  },
  'Mapbox Topolight': {
    url: 'mapbox://styles/wirhabenzeit/clk0tpduc00ab01qyguzi09gv',
    type: 'vector',
    visible: false,
    overlay: false,
  },
  'Mapbox Dark': {
    url: 'mapbox://styles/mapbox/dark-v11?optimize=true',
    type: 'vector',
    visible: false,
    overlay: false,
  },
  'Mapbox Satellite': {
    url: 'mapbox://styles/mapbox/satellite-v9?optimize=true',
    type: 'vector',
    visible: false,
    overlay: false,
  },
  'Swisstopo Light': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte.vt/style.json',
    type: 'vector',
    visible: false,
    overlay: false,
  },
  'Swisstopo Satellite': {
    url: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte-imagery.vt/style.json',
    type: 'vector',
    visible: false,
    overlay: false,
  },
  'Swisstopo Pixelkarte': {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`,
    type: 'raster',
    visible: false,
    overlay: false,
  },
  'Swisstopo Winter': {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`,
    type: 'raster',
    visible: false,
    overlay: false,
  },
  NorgesKart: {
    url: `https://opencache.statkart.no/gatekeeper/gk/gk.open_gmaps?layers=topo4&zoom={z}&x={x}&y={y}`,
    type: 'raster',
    visible: false,
    overlay: false,
  },
  // "SAC Tourenportal": {
  //   overlay: true,
  //   visible: false,
  //   type: "custom",
  //   component: LayerSAC,
  // },
  // "Friflyt Routes": {
  //   overlay: true,
  //   visible: false,
  //   type: "custom",
  //   component: LayerFriflyt,
  // },
  // "Quäldich Pässe": {
  //   overlay: true,
  //   visible: false,
  //   type: "custom",
  //   component: LayerQuaeldich,
  // },
  'Swisstopo Ski': {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`,
    type: 'raster',
    visible: false,
    opacity: 0.8,
    overlay: true,
  },
  'Swisstopo Slope': {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`,
    type: 'raster',
    visible: false,
    opacity: 0.4,
    overlay: true,
  },
  Veloland: {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png`,
    type: 'raster',
    visible: false,
    opacity: 0.4,
    overlay: true,
  },
  Wanderland: {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.wanderland/default/current/3857/{z}/{x}/{y}.png`,
    type: 'raster',
    visible: false,
    opacity: 0.4,
    overlay: true,
  },
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
