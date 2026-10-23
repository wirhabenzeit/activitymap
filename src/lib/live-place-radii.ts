import type { FeatureCollection, Polygon } from 'geojson';

import type { LiveCandidate, LivePlaceRequest } from '~/contracts/live-places';

export const PLACE_MATCH_COLORS = {
  matched: '#0f766e',
  nearby: '#64748b',
  incomplete: '#d97706',
};
export function livePlaceStatus(
  place: LiveCandidate,
  kind?: LiveCandidate['kinds'][number],
) {
  const evaluations = place.evaluations.filter((e) =>
    place.activityIds.includes(e.activityId),
  );
  if (
    evaluations.some(
      (e) =>
        e.complete &&
        (kind ? e.supportedKinds.includes(kind) : e.supportedKinds.length > 0),
    )
  )
    return 'matched';
  return evaluations.some((e) => !e.complete) ? 'incomplete' : 'nearby';
}
export function placeRadius(
  kind: LiveCandidate['kinds'][number],
  thresholds: LivePlaceRequest['thresholds'],
) {
  return thresholds[
    kind === 'peak'
      ? 'peakRadiusM'
      : kind === 'pass'
        ? 'passRadiusM'
        : 'hutRadiusM'
  ];
}

/** Geodesic metre-radius polygons, so zoom, latitude and map pitch do not change the distance. */
export function livePlaceRadii(
  places: LiveCandidate[],
  thresholds: LivePlaceRequest['thresholds'],
): FeatureCollection<
  Polygon,
  {
    id: string;
    kind: LiveCandidate['kinds'][number];
    radiusM: number;
    status: ReturnType<typeof livePlaceStatus>;
    color: string;
  }
> {
  const radians = Math.PI / 180;
  return {
    type: 'FeatureCollection',
    features: places.flatMap((place) =>
      place.kinds.map((kind) => {
        const radiusM = placeRadius(kind, thresholds);
        const distance = radiusM / 6_371_008.8;
        const latitude = place.latitude * radians,
          longitude = place.longitude * radians;
        const ring: number[][] = [];
        for (let i = 0; i < 64; i++) {
          const bearing = (-i * 2 * Math.PI) / 64;
          const lat = Math.asin(
            Math.sin(latitude) * Math.cos(distance) +
              Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing),
          );
          const lon =
            longitude +
            Math.atan2(
              Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude),
              Math.cos(distance) - Math.sin(latitude) * Math.sin(lat),
            );
          ring.push([lon / radians, lat / radians]);
        }
        ring.push([...ring[0]!]);
        const status = livePlaceStatus(place, kind);
        return {
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [ring] },
          properties: {
            id: place.id,
            kind,
            radiusM,
            status,
            color: PLACE_MATCH_COLORS[status],
          },
        };
      }),
    ),
  };
}
