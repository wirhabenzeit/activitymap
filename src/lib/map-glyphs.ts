import type { RequestTransformFunction } from 'maplibre-gl';

/**
 * App labels (place names) must render on every base map, but each style
 * brings its own glyph server and font names. App layers ask for this
 * fontstack; `transformMapRequest` redirects it to OpenFreeMap's Noto Sans,
 * whichever server the current style names.
 */
export const APP_LABEL_FONT = ['ActivityMap Sans'];
const APP_LABEL_FONT_PATTERN = /ActivityMap(?:%20| |\+)Sans/;
const APP_LABEL_GLYPHS =
  'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/{range}.pbf';

export const transformMapRequest: RequestTransformFunction = (
  url,
  resourceType,
) => {
  if (String(resourceType) !== 'Glyphs' || !APP_LABEL_FONT_PATTERN.test(url)) {
    return undefined;
  }
  const range = /(\d+-\d+)\.pbf/.exec(url)?.[1];
  return range
    ? { url: APP_LABEL_GLYPHS.replace('{range}', range) }
    : undefined;
};
