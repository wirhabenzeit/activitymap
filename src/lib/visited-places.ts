import type { VisitedPlace } from '~/contracts/visited-places';

export const VISITED_PLACES_HIT_LAYER = 'visited-places-hit';

/** Same visibility scope as routes; multiple encounters never duplicate a point. */
export function visibleVisitedPlaces<T extends VisitedPlace>(
  places: T[],
  activityIds: number[],
) {
  const ids = new Set(activityIds.map(String));
  return places.flatMap((place) => {
    const activityIds = place.activityIds.filter((id) => ids.has(id));
    return activityIds.length ? [{ ...place, activityIds }] : [];
  });
}

export function visitedPlaceKind(place: VisitedPlace) {
  return place.kinds.includes('peak')
    ? 'Peak'
    : place.kinds.includes('pass')
      ? 'Pass'
      : 'Hut vicinity';
}
