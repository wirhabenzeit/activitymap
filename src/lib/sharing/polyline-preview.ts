import { decode } from '@mapbox/polyline';

/**
 * Renders a Strava summary polyline as a self-contained SVG path string, so
 * the private share view (`~/app/share/[token]/page.tsx`) can show a route
 * shape without loading any map tiles. That matters for issue #132's "never
 * let the raw token leak ... into a `Referer` header from the share page
 * linking elsewhere" requirement: a tile request to a third-party map
 * provider would carry the current page's URL (including the capability
 * token) in its `Referer` header. Decoding and drawing the polyline
 * entirely inline avoids that request altogether.
 *
 * Returns `null` for an empty/undecodable polyline so callers can skip
 * rendering a preview rather than showing an empty shape.
 */
export function polylineToSvgPath(
  encoded: string,
  viewBoxSize = 200,
): { path: string; viewBox: string } | null {
  let points: [number, number][];
  try {
    points = decode(encoded);
  } catch {
    return null;
  }
  if (points.length < 2) return null;

  const lats = points.map(([lat]) => lat);
  const lngs = points.map(([, lng]) => lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latSpan = maxLat - minLat || 1;
  const lngSpan = maxLng - minLng || 1;
  const span = Math.max(latSpan, lngSpan);
  const padding = viewBoxSize * 0.05;
  const drawable = viewBoxSize - padding * 2;

  const projected = points.map(([lat, lng]) => {
    const x = padding + ((lng - minLng) / span) * drawable;
    // SVG y grows downward; latitude grows northward, so flip it.
    const y = padding + (1 - (lat - minLat) / span) * drawable;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return {
    path: `M ${projected.join(' L ')}`,
    viewBox: `0 0 ${viewBoxSize} ${viewBoxSize}`,
  };
}
