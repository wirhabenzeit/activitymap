import type { GeometryCollection } from 'geojson';

import {
  type Box,
  EARTH_RADIUS_M,
  arc,
  bounds,
  combine,
  vector,
} from './spatial-index';

export type PlaceQueryWindow = {
  west: number;
  south: number;
  east: number;
  north: number;
};
const degrees = 180 / Math.PI;
const slackDegrees = 1e-8;
export const placeQueryWindowKey = (box: PlaceQueryWindow) =>
  `${box.west},${box.south},${box.east},${box.north}`;
export const containsQueryWindow = (
  outer: PlaceQueryWindow,
  inner: PlaceQueryWindow,
) =>
  outer.west <= inner.west &&
  outer.east >= inner.east &&
  outer.south <= inner.south &&
  outer.north >= inner.north;

/** Every relevant point lies in this Cartesian envelope. Converting its Z
 * interval and XY rectangle to angular bounds is conservative, including arc
 * interiors, longitude wrap and poles. Never reinterpret a wide rectangle as a
 * geography polygon: PostGIS would curve its latitude edges. */
function geographicWindows(box: Box): PlaceQueryWindow[] {
  const south = Math.max(
    -90,
    Math.asin(Math.max(-1, box.low[2] / EARTH_RADIUS_M)) * degrees -
      slackDegrees,
  );
  const north = Math.min(
    90,
    Math.asin(Math.min(1, box.high[2] / EARTH_RADIUS_M)) * degrees +
      slackDegrees,
  );
  if (
    box.low[0] <= 0 &&
    box.high[0] >= 0 &&
    box.low[1] <= 0 &&
    box.high[1] >= 0
  )
    return [{ west: -180, south, east: 180, north }];
  const angles = [box.low[0], box.high[0]]
    .flatMap((x) =>
      [box.low[1], box.high[1]].map(
        (y) => (Math.atan2(y, x) * degrees + 360) % 360,
      ),
    )
    .sort((a, b) => a - b);
  let gap = -1,
    start = 0;
  for (let i = 0; i < angles.length; i++) {
    const next =
      angles[(i + 1) % angles.length]! + (i === angles.length - 1 ? 360 : 0);
    if (next - angles[i]! > gap) {
      gap = next - angles[i]!;
      start = next % 360;
    }
  }
  let west = start > 180 ? start - 360 : start;
  west -= slackDegrees;
  const east = west + (360 - gap) + 2 * slackDegrees;
  if (west < -180)
    return [
      { west: -180, south, east, north },
      { west: west + 360, south, east: 180, north },
    ];
  if (east > 180)
    return [
      { west, south, east: 180, north },
      { west: -180, south, east: east - 360, north },
    ];
  return [{ west, south, east, north }];
}

/** One padded envelope per continuous section, never a bridge between distant
 * recording sections/activities. Uses the local discovery radius plus 2m, so
 * filtering cannot remove any candidate the existing local matcher can see. */
export function placeQueryWindows(
  geometry: GeometryCollection,
  radiusM: number,
): PlaceQueryWindow[] {
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 2_000)
    throw new Error('Invalid place query radius');
  const result: PlaceQueryWindow[] = [];
  for (const part of geometry.geometries) {
    if (part.type !== 'Point' && part.type !== 'LineString')
      throw new Error('Invalid prepared geometry');
    const points =
      part.type === 'Point' ? [part.coordinates] : part.coordinates;
    if (!points.length) throw new Error('Empty prepared section');
    let previous = vector(points[0]!),
      envelope = bounds([previous]);
    for (let i = 1; i < points.length; i++) {
      const next = vector(points[i]!);
      envelope = combine([envelope, arc(previous, next).box]);
      previous = next;
    }
    result.push(...geographicWindows(combine([envelope], radiusM * 1.01 + 3)));
  }
  return uniqueQueryWindows(result);
}

export function uniqueQueryWindows(
  windows: readonly PlaceQueryWindow[],
): PlaceQueryWindow[] {
  const unique = new Map<string, PlaceQueryWindow>();
  for (const box of windows) {
    if (
      ![box.west, box.south, box.east, box.north].every(Number.isFinite) ||
      box.west < -180 ||
      box.east > 180 ||
      box.south < -90 ||
      box.north > 90 ||
      box.west > box.east ||
      box.south > box.north
    )
      throw new Error('Invalid place query window');
    unique.set(placeQueryWindowKey(box), { ...box });
  }
  return [...unique.values()];
}
