import polyline from '@mapbox/polyline';

import type { Activity } from './activity';

/** Prefer the detailed cache, falling back when it is absent or unusable. */
export function activityGPXCoordinates(
  activity: Pick<Activity, 'map_polyline' | 'map_summary_polyline'>,
): [number, number][] {
  for (const encoded of [
    activity.map_polyline,
    activity.map_summary_polyline,
  ]) {
    if (!encoded) continue;
    try {
      const coordinates = polyline.decode(encoded);
      if (
        coordinates.length &&
        coordinates.every(
          ([lat, lon]) =>
            Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lon) <= 180,
        )
      )
        return coordinates.map(([lat, lon]) => [lon, lat]);
    } catch {
      /* Try the other cached representation. */
    }
  }
  return [];
}
