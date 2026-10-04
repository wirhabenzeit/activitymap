import polyline from '@mapbox/polyline';
import type { Activity } from '~/server/db/schema';

export type RouteBounds = [[number, number], [number, number]];
type Rect = { left: number; top: number; right: number; bottom: number };

/** Match the geometry displayed by createFeature, including its summary preference. */
export function routeCoordinates(
  activity: Pick<Activity, 'map_summary_polyline' | 'map_polyline'>,
): [number, number][] {
  const encoded = activity.map_summary_polyline?.length
    ? activity.map_summary_polyline
    : activity.map_polyline;
  if (!encoded) return [];
  try {
    return polyline.decode(encoded).map(([lat, lng]) => [lng, lat]);
  } catch {
    return [];
  }
}

/** The shortest longitude arc also frames routes crossing the date line. */
export function routeBounds(
  coordinates: readonly (readonly number[])[],
): RouteBounds | null {
  const valid = coordinates.filter(
    ([lng, lat]) =>
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Math.abs(lng!) <= 180 &&
      Math.abs(lat!) <= 90,
  );
  if (!valid.length) return null;
  const longitudes = valid
    .map(([lng]) => (lng! + 360) % 360)
    .sort((a, b) => a - b);
  let gap = -1,
    index = 0;
  longitudes.forEach((lng, i) => {
    const next = longitudes[i + 1] ?? longitudes[0]! + 360;
    if (next - lng > gap) {
      gap = next - lng;
      index = i;
    }
  });
  let west = longitudes[(index + 1) % longitudes.length]!;
  if (west > 180) west -= 360;
  const east = west + 360 - gap;
  let south = 85,
    north = -85;
  for (const [, lat] of valid) {
    south = Math.min(south, Math.max(-85, lat!));
    north = Math.max(north, Math.min(85, lat!));
  }
  // Keep points and very short routes well-defined; the camera also caps zoom.
  return [
    [west - 0.00005, south - 0.00005],
    [east + 0.00005, north + 0.00005],
  ];
}

/** Choose the larger usable rectangle above or beside a bottom results panel. */
export function routeFitPadding(map: Rect, panel?: Rect | null) {
  const width = map.right - map.left,
    height = map.bottom - map.top;
  const base = { top: 32, left: 24, right: 64, bottom: 40 };
  const usable = (p: typeof base) =>
    width - p.left - p.right >= 80 && height - p.top - p.bottom >= 80;
  const area = (p: typeof base) =>
    Math.max(0, width - p.left - p.right) *
    Math.max(0, height - p.top - p.bottom);
  let padding = base;
  if (
    panel &&
    panel.right > map.left &&
    panel.left < map.right &&
    panel.bottom > map.top &&
    panel.top < map.bottom
  ) {
    const above = {
      ...base,
      bottom: Math.max(base.bottom, map.bottom - panel.top + 24),
    };
    const beside = {
      ...base,
      right: Math.max(base.right, map.right - panel.left + 24),
    };
    const candidates = [above, beside].filter(usable);
    if (!candidates.length) return null;
    padding = candidates.sort((a, b) => area(b) - area(a))[0]!;
  }
  return usable(padding) ? padding : null;
}
