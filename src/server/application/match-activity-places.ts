import type {
  ActivityPlacesResponse,
  MatchedPlace,
} from '~/contracts/activity-places';
import { matchEncounters } from '~/server/places/encounters';
import {
  DEFAULT_MATCHER_POLICY,
  MATCHER_VERSION,
  type MatcherPolicy,
  validatePolicy,
} from '~/server/places/policy';
import type { PublishedCatalogue } from '~/server/places/published-catalogue';
import {
  type PreparedTrack,
  prepareTrack,
} from '~/server/places/track-sections';
import type {
  CandidatePlace,
  PlaceDiscoveryInput,
} from '~/server/repositories/places';

export type ActivityPlaceInput = {
  payload: unknown;
  too_large?: boolean;
  generation: string | null;
  revision: string;
};
export async function matchActivityPlaces(options: {
  userId: string;
  activityId: string;
  input: ActivityPlaceInput;
  catalogue: PublishedCatalogue | null;
  /** Batch workers pin one immutable policy for the entire run. */
  policy?: Readonly<MatcherPolicy>;
  /** Internal batches may reuse a track prepared with the same pinned policy. */
  preparedTrack?: PreparedTrack;
  discover: (input: PlaceDiscoveryInput) => Promise<{
    candidates: CandidatePlace[];
    covered: boolean;
    truncated: boolean;
  }>;
}): Promise<ActivityPlacesResponse> {
  const { input, catalogue } = options;
  const response: ActivityPlacesResponse = {
    userId: options.userId,
    activityId: options.activityId,
    status: 'missing_streams',
    streamGeneration: input.generation,
    streamRevision: input.revision,
    catalogueSnapshotId: catalogue?.manifest.catalogue_snapshot_id ?? null,
    matcherVersion: MATCHER_VERSION,
    places: [],
  };
  if (input.too_large) return { ...response, status: 'partial' };
  if (input.payload == null && !options.preparedTrack) return response;
  if (!catalogue) return { ...response, status: 'unavailable' };
  const policy = validatePolicy(options.policy ?? DEFAULT_MATCHER_POLICY);
  const track = options.preparedTrack ?? prepareTrack(input.payload, policy);
  if (!track.sections.length)
    return {
      ...response,
      status: track.partial ? 'partial' : 'missing_streams',
    };
  const discovered = await options.discover({
    geometry: track.geometry,
    coverage: catalogue.coverage,
    catalogueSnapshotId: catalogue.manifest.catalogue_snapshot_id,
    radiusM: policy.discoveryRadiusM,
    limit: policy.maxCandidates,
  });
  if (!discovered.covered) return { ...response, status: 'uncovered' };
  const matched = matchEncounters(track, discovered.candidates, policy);
  // Budget exhaustion is not a trustworthy completed result, including zeroes.
  if (track.partial || discovered.truncated || matched.partial)
    return { ...response, status: 'partial' };
  const candidates = new Map(
    discovered.candidates.map((place) => [place.id, place]),
  );
  const places: MatchedPlace[] = [];
  for (const match of matched.matches) {
    const candidate = candidates.get(match.placeId)!;
    const visits: MatchedPlace['visits'] = [];
    const supportedKinds = new Set<MatchedPlace['kinds'][number]>();
    for (const encounter of match.evidence.encounters) {
      const supported = encounter.fragments.filter((fragment) =>
        fragment.relation_assessments.some(
          (assessment) => assessment.status === 'supported',
        ),
      );
      if (!supported.length) continue;
      for (const fragment of supported)
        for (const assessment of fragment.relation_assessments) {
          if (assessment.status !== 'supported') continue;
          if (assessment.relation === 'reached_peak')
            supportedKinds.add('peak');
          if (assessment.relation === 'visited_pass')
            supportedKinds.add('pass');
          if (assessment.relation === 'arrived_at_hut')
            supportedKinds.add('hut');
        }
      const peakFragments = supported.filter(
        (fragment) =>
          fragment.peak_match &&
          fragment.relation_assessments.some(
            (a) => a.relation === 'reached_peak' && a.status === 'supported',
          ),
      );
      const bestPeak = peakFragments.reduce<
        (typeof supported)[number] | undefined
      >(
        (best, fragment) =>
          !best ||
          fragment.peak_match!.weighted_score < best.peak_match!.weighted_score
            ? fragment
            : best,
        undefined,
      );
      const closest = supported.reduce((best, fragment) =>
        fragment.min_horizontal_distance_m < best.min_horizontal_distance_m
          ? fragment
          : best,
      );
      // Peak profile marks identify the actual scoring point; other relations
      // retain their horizontal closest point. Never mix section-local distances.
      const position =
        bestPeak?.peak_match?.route_distance_m ?? closest.route_distance_m;
      visits.push({
        distanceM:
          position?.basis === 'provider_distance' ? position.closest : null,
      });
    }
    if (!visits.length) continue;
    places.push({
      id: candidate.id,
      name: candidate.displayName,
      kinds: [...supportedKinds],
      longitude: candidate.location.longitude,
      latitude: candidate.location.latitude,
      elevationM: candidate.elevationM ?? null,
      visits,
    });
  }
  places.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  return { ...response, status: 'complete', places };
}

export class ActivityPlacesUnavailableError extends Error {}
export class ActivityPlacesInputChangedError extends Error {}
