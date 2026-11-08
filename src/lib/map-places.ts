import type { MatchedPlace } from '~/contracts/activity-places';

import { type ProjectedMapPoint, groupMapPoints } from './map-point-groups';

export function mapPlaceClusterKind(places: Pick<MatchedPlace, 'kinds'>[]) {
  const kinds = new Set(places.flatMap((place) => place.kinds));
  return kinds.size === 1 ? [...kinds][0]! : 'mixed';
}

export const mapPlacePolicy = {
  labelZoom: 12,
  pinSpacing: 48,
  viewportMargin: 44,
  maxMarkers: 80,
} as const;

export function groupMapPlaces(
  points: ProjectedMapPoint[],
  viewport: { width: number; height: number },
  focusedId?: string,
) {
  // An inspected place gets its own symbol, even inside a dense cluster.
  const focused = points.find((point) => point.id === focusedId);
  const groups = groupMapPoints(
    points.filter((point) => point.id !== focusedId),
    viewport,
    {
      ...mapPlacePolicy,
      spacing: mapPlacePolicy.pinSpacing,
      maxMarkers: mapPlacePolicy.maxMarkers - (focused ? 1 : 0),
    },
  );
  if (focused) {
    groups.push(
      ...groupMapPoints([focused], viewport, {
        ...mapPlacePolicy,
        spacing: mapPlacePolicy.pinSpacing,
      }),
    );
  }
  return groups;
}
