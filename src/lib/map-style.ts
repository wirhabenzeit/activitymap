import type {
  RasterDEMSourceSpecification,
  SkySpecification,
  StyleSpecification,
  TerrainSpecification,
} from 'maplibre-gl';

import {
  type BaseMapId,
  type WebStyleTemplateId,
  baseMaps,
  mapTilerKey,
  renderableBaseMap,
} from '~/settings/map';

/**
 * Each generated template is its own chunk, so the 340 kB Outdoor style is
 * only downloaded by people who pick it.
 */
const templateLoaders: Record<
  WebStyleTemplateId,
  () => Promise<{ default: unknown }>
> = {
  mapboxStreet: () =>
    import('../../shared/map-styles/generated/mapboxStreet.json'),
  mapboxStreet3d: () =>
    import('../../shared/map-styles/generated/mapboxStreet3d.json'),
  mapboxOutdoors: () =>
    import('../../shared/map-styles/generated/mapboxOutdoors.json'),
  mapboxLight: () =>
    import('../../shared/map-styles/generated/mapboxLight.json'),
  mapboxTopolight: () =>
    import('../../shared/map-styles/generated/mapboxTopolight.json'),
  mapboxDark: () => import('../../shared/map-styles/generated/mapboxDark.json'),
  mapboxSatellite: () =>
    import('../../shared/map-styles/generated/mapboxSatellite.json'),
};

const OPENFREEMAP_GLYPHS =
  'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** Substitutes the public web key; templates never contain a real key. */
export const resolveMapTilerKey = (
  style: StyleSpecification,
  key: string | undefined,
): StyleSpecification => {
  const json = JSON.stringify(style);
  if (!json.includes('{MAPTILER_KEY}')) return style;
  if (!key) throw new Error('This base map requires a MapTiler key');
  return JSON.parse(
    json.replaceAll('{MAPTILER_KEY}', encodeURIComponent(key)),
  ) as StyleSpecification;
};

const withGlyphs = (style: StyleSpecification): StyleSpecification =>
  style.glyphs ? style : { ...style, glyphs: OPENFREEMAP_GLYPHS };

const rasterStyle = (
  url: string,
  tileSize: number,
  attribution: string | undefined,
): StyleSpecification => ({
  version: 8,
  glyphs: OPENFREEMAP_GLYPHS,
  sources: {
    baseMap: {
      type: 'raster',
      tiles: [url],
      tileSize,
      ...(attribution === undefined ? {} : { attribution }),
    },
  },
  layers: [{ id: 'baseMap', type: 'raster', source: 'baseMap' }],
});

/**
 * The style to hand to MapLibre for a catalogue base map: a URL for remote
 * vector styles, otherwise an in-memory style object. Unavailable maps (a
 * MapTiler style without a key) fall back to the default.
 */
export const loadBaseMapStyle = async (
  requested: BaseMapId,
): Promise<StyleSpecification | string> => {
  const setting = baseMaps[renderableBaseMap(requested)];
  switch (setting.type) {
    case 'vector':
      return setting.url;
    case 'raster':
      return rasterStyle(setting.url, setting.tileSize, setting.attribution);
    case 'template': {
      const template = (await templateLoaders[setting.template]())
        .default as StyleSpecification;
      return withGlyphs(resolveMapTilerKey(template, mapTilerKey));
    }
  }
};

/** Terrain source shared by every base map; see docs/maplibre-source-research.md. */
export const TERRAIN_SOURCE_ID = 'terrain-dem';
export const terrainSource: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
  encoding: 'terrarium',
  tileSize: 512,
  // Mapterhorn covers the globe to z12 and only some regions beyond it; a
  // higher limit would leave terrain holes where tiles 404.
  maxzoom: 12,
  attribution:
    '<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>',
};

export const TERRAIN_EXAGGERATION = 1.5;

/**
 * Terrain is switched off entirely in 2D rather than flattened, so MapLibre
 * skips terrain rendering and DEM downloads. react-map-gl passes `null`
 * through to `setTerrain`, although its prop type only names `undefined`
 * (which it treats as "leave unchanged").
 */
export const terrainFor = (enabled: boolean): TerrainSpecification =>
  (enabled
    ? { source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION }
    : null) as TerrainSpecification;

/** A pale blue sky with an atmosphere halo around the globe. */
export const mapSky: SkySpecification = {
  'sky-color': '#7fb6e6',
  'horizon-color': '#dcecf8',
  'fog-color': '#eef5fb',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.5,
  'fog-ground-blend': 0.85,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 1, 11, 0],
};
