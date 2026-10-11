import polyline from '@mapbox/polyline';
import type { Feature, FeatureCollection, LineString } from 'geojson';

import type { SharedActivityDTO } from '~/contracts/share/activity';
import type { ElevationProfile } from '~/lib/activity-stream-summary';
import { decodeStreamSummary } from '~/lib/streams/compact-summary';

export type SharedRouteProperties = {
  id: string;
  sportType: string;
};

function activityCoordinates(activity: SharedActivityDTO): [number, number][] {
  if (!activity.route_polyline) return [];
  return polyline
    .decode(activity.route_polyline)
    .map(([latitude, longitude]) => [longitude, latitude]);
}

/** Build the exact route subset a capability link is allowed to display. */
export function buildSharedRouteCollection(
  activities: SharedActivityDTO[],
): FeatureCollection<LineString, SharedRouteProperties> {
  return {
    type: 'FeatureCollection',
    features: activities.flatMap((activity) => {
      const coordinates = activityCoordinates(activity);
      if (coordinates.length === 0) return [];
      const feature: Feature<LineString, SharedRouteProperties> = {
        type: 'Feature',
        id: activity.id,
        properties: {
          id: activity.id,
          sportType: activity.sport_type,
        },
        geometry: { type: 'LineString', coordinates },
      };
      return [feature];
    }),
  };
}

/** Decode a shared track's elevation profile for `ElevationPlot`. */
export function sharedElevationProfile(
  activity: SharedActivityDTO,
): ElevationProfile | null {
  if (!activity.elevation_profile) return null;
  try {
    const { distance, altitude, latlng } = decodeStreamSummary(
      activity.elevation_profile,
    );
    if (!distance || !altitude) return null;
    return { distance, altitude, ...(latlng ? { latlng } : {}) };
  } catch {
    return null;
  }
}
