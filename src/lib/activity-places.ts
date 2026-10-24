import type {
  ActivityPlacesResponse,
  MatchedPlace,
} from '~/contracts/activity-places';
import type { ActivityDTO } from '~/contracts/v1/activity';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import type { ElevationProfile } from '~/lib/activity-stream-summary';
import { nearestElevationSample } from '~/lib/elevation-profile';

export const MATCHED_PLACES_HIT_LAYER = 'matched-places-hit';
export const activityPlacesQueryRoot = (userId: string, activityId: string) =>
  ['library', `auth:${userId}`, 'activity-places', activityId] as const;
export const activityPlacesQueryKey = (
  userId: string,
  activityId: string,
  metadata?: StreamMetadata,
  matchingVersion?: string,
) => [
  ...activityPlacesQueryRoot(userId, activityId),
  metadata?.generation ?? null,
  metadata?.revision ?? '0',
  metadata?.state ?? 'not_fetched',
  ...(matchingVersion ? [matchingVersion] : []),
];
/** A synchronized bundle is authoritative only for its account, inputs and
 * global version. Retaining old data on disk never makes it current. */
export function syncedActivityPlaces(
  activity: ActivityDTO | undefined,
  userId: string,
  version: string | undefined,
  metadata = activity?.streams,
): ActivityPlacesResponse | undefined {
  const result = activity?.placeMatches;
  if (
    !result ||
    !version ||
    result.userId !== userId ||
    result.activityId !== activity?.id ||
    result.matchingVersion !== version
  )
    return undefined;
  if (
    metadata &&
    (result.streamGeneration !== metadata.generation ||
      result.streamRevision !== metadata.revision ||
      (result.status === 'complete' && metadata.state !== 'current'))
  )
    return undefined;
  return result;
}
export type SelectedMatchedPlace = MatchedPlace & { activityIds: string[] };
export function selectedMatchedPlaces(
  results: (ActivityPlacesResponse | undefined)[],
  userId: string,
  selectedIds: ReadonlySet<string>,
): SelectedMatchedPlace[] {
  const places = new Map<string, SelectedMatchedPlace>();
  for (const result of results) {
    if (
      result?.userId !== userId ||
      !selectedIds.has(result.activityId) ||
      result.status !== 'complete'
    )
      continue;
    for (const place of result.places) {
      const existing = places.get(place.id);
      if (existing) {
        if (!existing.activityIds.includes(result.activityId))
          existing.activityIds.push(result.activityId);
        existing.kinds = [...new Set([...existing.kinds, ...place.kinds])];
      } else
        places.set(place.id, {
          ...place,
          kinds: [...place.kinds],
          activityIds: [result.activityId],
        });
    }
  }
  return [...places.values()];
}
export function placesMatchProfile(
  result: ActivityPlacesResponse | undefined,
  metadata: StreamMetadata | null | undefined,
): boolean {
  return (
    result?.status === 'complete' &&
    metadata?.state === 'current' &&
    result.streamGeneration === metadata.generation &&
    result.streamRevision === metadata.revision
  );
}
export function placeKindLabel(place: Pick<MatchedPlace, 'kinds'>) {
  return place.kinds
    .map((kind) =>
      kind === 'peak' ? 'Peak' : kind === 'pass' ? 'Pass' : 'Hut',
    )
    .join(' · ');
}
export function elevationPlaceMarkers(
  profile: ElevationProfile,
  places: MatchedPlace[],
) {
  const first = profile.distance[0]!;
  const last = profile.distance.at(-1)!;
  return places
    .flatMap((place) =>
      place.visits.flatMap((visit, visitIndex) => {
        if (visit.distanceM === null) return [];
        // The summary averages its endpoint buckets; real raw endpoint encounters
        // can sit just outside its averaged domain. Keep them at the plot edge.
        const distanceM = Math.max(first, Math.min(last, visit.distanceM));
        let index = 0;
        while (
          index < profile.distance.length - 2 &&
          profile.distance[index + 1]! < distanceM
        )
          index++;
        const next = Math.min(index + 1, profile.distance.length - 1);
        const span = profile.distance[next]! - profile.distance[index]!;
        const fraction =
          span > 0 ? (distanceM - profile.distance[index]!) / span : 0;
        return [
          {
            key: `${place.id}:${visitIndex}`,
            placeId: place.id,
            visitIndex,
            name: place.name,
            kinds: place.kinds,
            distanceM,
            altitudeM:
              profile.altitude[index]! +
              (profile.altitude[next]! - profile.altitude[index]!) * fraction,
            sampleIndex: nearestElevationSample(profile, distanceM),
          },
        ];
      }),
    )
    .sort((a, b) => a.distanceM - b.distanceM || a.key.localeCompare(b.key));
}
