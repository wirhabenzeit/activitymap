// Style prototypes only. The live shared/map-catalog.json is intentionally separate.
export const profiles = {
  mapboxStreet: {
    name: 'ActivityMap Street',
    base: 'liberty',
    theme: 'street',
  },
  mapboxStreet3d: {
    name: 'ActivityMap Street 3D',
    base: 'liberty',
    theme: 'street',
  },
  mapboxOutdoors: {
    name: 'ActivityMap Outdoor',
    base: 'outdoor',
    theme: 'outdoor',
  },
  mapboxLight: { name: 'ActivityMap Light', base: 'positron', theme: 'light' },
  mapboxTopolight: {
    name: 'ActivityMap Topolight',
    base: 'positron',
    theme: 'topolight',
  },
  mapboxDark: { name: 'ActivityMap Dark', base: 'dark', theme: 'dark' },
  mapboxSatellite: {
    name: 'ActivityMap Satellite',
    base: 'satellite',
    theme: 'satellite',
  },
};

const palettes = {
  street: {
    background: '#f3f1ef',
    water: '#99ddff',
    wood: '#c7e2bd',
    park: '#d2e9c9',
    building: '#ded7d2',
    text: '#59616b',
    halo: '#f7f6f3',
  },
  light: {
    background: '#f7f7f8',
    water: '#dedee2',
    wood: '#ededee',
    park: '#f0f0f1',
    building: '#e4e4e7',
    text: '#909197',
    halo: '#f7f7f8',
  },
  dark: {
    background: '#25272a',
    water: '#1a1e23',
    wood: '#292e2d',
    park: '#2d3330',
    building: '#303337',
    text: '#b3b9c1',
    halo: '#25272a',
  },
  topolight: {
    background: '#f7f8f8',
    water: '#d2d6d6',
    wood: '#eceeee',
    park: '#e9eceb',
    building: '#e0e3e3',
    text: '#7d8587',
    halo: '#f7f8f8',
  },
};

function paint(style, id, values) {
  const layer = style.layers.find((layer) => layer.id === id);
  if (!layer) throw new Error(`Missing upstream layer: ${id}`);
  Object.assign((layer.paint ??= {}), values);
  return layer;
}

// Templates carry no account key. Resolve only URL fields, including sprite arrays.
function mapURLs(value, transform, key = '') {
  if (typeof value === 'string') {
    return ['url', 'tiles', 'glyphs', 'sprite'].includes(key)
      ? transform(value)
      : value;
  }
  if (Array.isArray(value))
    return value.map((item) => mapURLs(item, transform, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, item]) => [
        k,
        mapURLs(item, transform, k),
      ]),
    );
  }
  return value;
}

function tokenizedURL(url) {
  if (!url.startsWith('https://api.maptiler.com/')) return url;
  // Preserve glyph and XYZ braces; URLSearchParams would encode them.
  const clean = url.replace(/([?&])key=[^&#]*/g, '$1key={MAPTILER_KEY}');
  return /[?&]key=/.test(clean)
    ? clean
    : `${clean}${clean.includes('?') ? '&' : '?'}key={MAPTILER_KEY}`;
}

export function resolveStyleKey(style, key) {
  if (JSON.stringify(style).includes('{MAPTILER_KEY}') && !key) {
    throw new Error('This style requires a MapTiler public API key');
  }
  return mapURLs(style, (url) =>
    url.replaceAll('{MAPTILER_KEY}', encodeURIComponent(key ?? '')),
  );
}

export function buildStyle(id, upstream, trailOverrides) {
  const profile = profiles[id];
  if (!profile) throw new Error(`Unknown prototype style: ${id}`);
  if (!upstream[profile.base])
    throw new Error(`Missing upstream style: ${profile.base}`);
  let style = structuredClone(upstream[profile.base]);
  style.name = profile.name;
  // Provider editor state and camera defaults are not part of our cartography.
  for (const field of [
    'id',
    'owner',
    'created',
    'modified',
    'center',
    'zoom',
    'bearing',
    'pitch',
    'terrain',
    'sky',
    'projection',
  ])
    Reflect.deleteProperty(style, field);
  style.metadata = {
    ...style.metadata,
    'activitymap:prototype': 1,
    'activitymap:catalog-id': id,
    'activitymap:upstream': profile.base,
  };
  const palette = palettes[profile.theme];
  if (palette) {
    paint(style, 'background', { 'background-color': palette.background });
    paint(style, 'water', { 'fill-color': palette.water });
    paint(style, 'building', {
      'fill-color': palette.building,
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        13,
        0.08,
        15,
        0.55,
        17,
        0.85,
      ],
    });
    for (const layer of style.layers) {
      const p = (layer.paint ??= {});
      if (layer.type === 'fill' && /wood|grass/.test(layer.id))
        p['fill-color'] = palette.wood;
      if (layer.type === 'fill' && /park/.test(layer.id))
        p['fill-color'] = palette.park;
      if (layer.type === 'fill' && /residential/.test(layer.id))
        p['fill-color'] = palette.background;
      if (layer.type === 'line' && /waterway/.test(layer.id))
        p['line-color'] = palette.water;
      if (layer.type === 'symbol' && layer.layout?.['text-field']) {
        p['text-color'] = palette.text;
        p['text-halo-color'] = palette.halo;
        p['text-halo-width'] = 1;
        if (/poi/.test(layer.id)) p['text-opacity'] = 0.6;
      }
      if (
        layer.type === 'line' &&
        /road|highway|bridge|tunnel/.test(layer.id) &&
        !/rail|boundary|water/.test(layer.id)
      ) {
        const casing = /casing|outline/.test(layer.id);
        p['line-color'] =
          profile.theme === 'dark'
            ? casing
              ? '#292d32'
              : '#363a40'
            : casing
              ? '#ddd9d4'
              : '#ffffff';
      }
    }
    if (profile.theme === 'street') {
      // Keep ordinary Street flat; Street 3D uses the real OMT height fields below.
      const extrusion = paint(style, 'building-3d', {
        'fill-extrusion-color': '#ded7d2',
        'fill-extrusion-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14.9,
          0,
          16,
          0.65,
        ],
        'fill-extrusion-height': [
          'max',
          0,
          ['coalesce', ['get', 'render_height'], 0],
        ],
        'fill-extrusion-base': [
          'max',
          0,
          ['coalesce', ['get', 'render_min_height'], 0],
        ],
      });
      extrusion.minzoom = 15;
      extrusion.layout = {
        ...extrusion.layout,
        visibility: id === 'mapboxStreet3d' ? 'visible' : 'none',
      };
      for (const layer of style.layers) {
        if (
          layer.type === 'line' &&
          /motorway|trunk_primary/.test(layer.id) &&
          !/casing|rail|hatching/.test(layer.id)
        )
          layer.paint['line-color'] = '#f4e3c3';
      }
    }
    if (profile.theme === 'dark') {
      for (const layer of style.layers) {
        if (
          layer.type === 'symbol' &&
          layer.layout?.['text-field'] &&
          /place_/.test(layer.id)
        )
          layer.paint['text-color'] = '#c8cdd4';
        if (layer.type === 'line' && /railway/.test(layer.id))
          Object.assign(layer.paint, {
            'line-color': '#43464c',
            'line-opacity': 0.6,
          });
      }
    }
  }
  if (profile.theme === 'outdoor') {
    for (const override of trailOverrides.layers)
      paint(style, override.id, override.paint);
  }
  if (profile.theme === 'topolight') {
    // Inspection of the current Studio style found grayscale mapping + hillshade,
    // not contour geometry. This matches that role without a paid contour source.
    style.sources['activitymap-dem'] = {
      type: 'raster-dem',
      tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
      tileSize: 512,
      encoding: 'terrarium',
      maxzoom: 12,
      attribution:
        '<a href="https://mapterhorn.com/attribution/">© Mapterhorn and elevation data providers</a>',
    };
    const firstLine = style.layers.findIndex((layer) => layer.type === 'line');
    style.layers.splice(firstLine, 0, {
      id: 'activitymap-hillshade',
      type: 'hillshade',
      source: 'activitymap-dem',
      paint: {
        'hillshade-exaggeration': 0.4,
        'hillshade-shadow-color': '#737c7d',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#a9aeae',
      },
    });
  }
  if (profile.theme === 'satellite') {
    // Match satellite-v9's imagery-only role. Provider imagery resolution is unchanged.
    style.layers = style.layers.filter((layer) =>
      ['background', 'raster'].includes(layer.type),
    );
    const used = new Set(
      style.layers.map((layer) => layer.source).filter(Boolean),
    );
    style.sources = Object.fromEntries(
      Object.entries(style.sources).filter(([source]) => used.has(source)),
    );
    delete style.glyphs;
    delete style.sprite;
  }
  style = mapURLs(style, tokenizedURL);
  if (JSON.stringify(style).includes('mapbox://'))
    throw new Error(`Mapbox dependency in ${id}`);
  return style;
}
