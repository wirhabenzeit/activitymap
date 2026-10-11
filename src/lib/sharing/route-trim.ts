/** Distance hidden at each end of a shared route unless the athlete opts in. */
export const SHARED_ROUTE_END_TRIM_METERS = 200;

/** `[latitude, longitude]`, as produced by `@mapbox/polyline`'s `decode`. */
export type LatLng = [number, number];

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function haversineMeters([lat1, lng1]: LatLng, [lat2, lng2]: LatLng) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function interpolate([lat1, lng1]: LatLng, [lat2, lng2]: LatLng, t: number): LatLng {
  return [lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t];
}

/**
 * Remove `trimMeters` of path from both ends of a route, cutting exactly at
 * that distance along the line. Returns `[]` when too little would remain
 * (less than another `trimMeters` of visible route), so a short activity
 * shares no route at all rather than a stub that sits on top of its start.
 */
export function trimRouteEnds(
  points: LatLng[],
  trimMeters = SHARED_ROUTE_END_TRIM_METERS,
): LatLng[] {
  if (points.length < 2) return [];

  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + haversineMeters(points[index - 1]!, points[index]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total < trimMeters * 3) return [];

  const pointAt = (distance: number): LatLng => {
    const index = cumulative.findIndex((value) => value >= distance);
    const start = cumulative[index - 1]!;
    const span = cumulative[index]! - start;
    return interpolate(points[index - 1]!, points[index]!, span === 0 ? 0 : (distance - start) / span);
  };

  const startCut = trimMeters;
  const endCut = total - trimMeters;
  const interior = points.filter(
    (_, index) => cumulative[index]! > startCut && cumulative[index]! < endCut,
  );
  return [pointAt(startCut), ...interior, pointAt(endCut)];
}
