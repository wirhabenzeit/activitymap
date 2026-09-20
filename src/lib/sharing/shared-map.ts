import polyline from '@mapbox/polyline';
import type { Feature, FeatureCollection, LineString } from 'geojson';

import type { SharedActivityDTO } from '~/contracts/share/activity';

export type SharedRouteProperties = {
  id: string;
  sportType: string;
};

function activityCoordinates(activity: SharedActivityDTO): [number, number][] {
  if (!activity.map_summary_polyline) return [];
  return polyline
    .decode(activity.map_summary_polyline)
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
