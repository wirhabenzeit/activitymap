import {
  type PlaceDebugResponse,
  type PlaceDebugSettings,
  placeDebugSettingsSchema,
} from '~/contracts/place-debug';
import {
  inspectClosestPlace,
  matchEncounters,
} from '~/server/places/encounters';
import { SERVER_MATCHER_POLICY } from '~/server/places/matching-version';
import { MATCHER_VERSION, validatePolicy } from '~/server/places/policy';
import { prepareTrack } from '~/server/places/track-sections';
import type { PlaceEncounterFragment } from '~/server/places/types';

import type { matchActivityPlaces } from './match-activity-places';

/** Read-only experiment. Budgets and track validation are identical to production. */
export async function debugActivityPlaces(
  options: Parameters<typeof matchActivityPlaces>[0] & {
    settings: PlaceDebugSettings;
  },
): Promise<PlaceDebugResponse> {
  const settings = placeDebugSettingsSchema.parse(options.settings);
  const policy = validatePolicy({ ...SERVER_MATCHER_POLICY, ...settings });
  const response: PlaceDebugResponse = {
    userId: options.userId,
    activityId: options.activityId,
    status: 'missing_streams',
    streamGeneration: options.input.generation,
    streamRevision: options.input.revision,
    catalogueSnapshotId:
      options.catalogue?.manifest.catalogue_snapshot_id ?? null,
    matcherVersion: MATCHER_VERSION,
    settings,
    candidates: [],
    reasons: [],
  };
  if (options.input.too_large)
    return { ...response, status: 'partial', reasons: ['sample_limit'] };
  if (options.input.payload == null) return response;
  if (!options.catalogue) return { ...response, status: 'unavailable' };
  const track = prepareTrack(options.input.payload, policy);
  if (!track.sections.length)
    return {
      ...response,
      status: track.partial ? 'partial' : 'missing_streams',
      reasons: track.reasons,
    };
  // Include the default corridor too, so comparisons remain valid when shrinking discovery.
  const discovered = await options.discover({
    geometry: track.geometry,
    coverage: options.catalogue.coverage,
    catalogueSnapshotId: options.catalogue.manifest.catalogue_snapshot_id,
    radiusM: Math.max(
      policy.discoveryRadiusM,
      SERVER_MATCHER_POLICY.discoveryRadiusM,
    ),
    limit: policy.maxCandidates,
  });
  if (!discovered.covered) return { ...response, status: 'uncovered' };
  const experimental = matchEncounters(track, discovered.candidates, policy);
  const baseline = matchEncounters(
    track,
    discovered.candidates,
    SERVER_MATCHER_POLICY,
  );
  const incomplete =
    track.partial ||
    discovered.truncated ||
    experimental.partial ||
    baseline.partial;
  const supported = new Set(
    experimental.matches
      .filter((m) => m.evidence.supported_relations.length)
      .map((m) => m.placeId),
  );
  const defaultSupported = new Set(
    baseline.matches
      .filter((m) => m.evidence.supported_relations.length)
      .map((m) => m.placeId),
  );
  const encounters = new Map(
    experimental.matches.map((m) => [m.placeId, m.evidence]),
  );
  // Extra debug measurements have their own fixed comparison budget. Never scan unbounded GPS.
  const sampleCount = track.sections.reduce(
    (sum, section) => sum + section.samples.length,
    0,
  );
  let remaining = policy.maxComparisons;
  const reasons = new Set([...experimental.reasons, ...baseline.reasons]);
  if (discovered.truncated) reasons.add('candidate_limit');
  for (const place of discovered.candidates) {
    const measurable = remaining >= sampleCount;
    const nearest = measurable
      ? inspectClosestPlace(track, place, policy)
      : undefined;
    remaining -= measurable ? sampleCount : 0;
    if (!measurable) reasons.add('debug_comparison_limit');
    const outsideDiscovery =
      nearest && nearest.min_horizontal_distance_m > policy.discoveryRadiusM;
    const matched = !incomplete && !outsideDiscovery && supported.has(place.id);
    const evidence = encounters.get(place.id);
    const assessments =
      evidence?.encounters.flatMap((e) => e.relation_assessments) ?? [];
    const uncertain =
      incomplete ||
      !nearest ||
      assessments.some((a) => a.status === 'uncertain');
    const peakFragment = evidence?.encounters
      .flatMap((e) => e.fragments)
      .filter((fragment) => fragment.peak_match)
      .reduce<PlaceEncounterFragment | undefined>((best, fragment) => {
        if (!best) return fragment;
        const supportsPeak = (value: typeof fragment) =>
          value.relation_assessments.some(
            (a) => a.relation === 'reached_peak' && a.status === 'supported',
          );
        if (supportsPeak(fragment) !== supportsPeak(best))
          return supportsPeak(fragment) ? fragment : best;
        return fragment.peak_match!.weighted_score <
          best.peak_match!.weighted_score
          ? fragment
          : best;
      }, undefined);
    const peak = peakFragment?.peak_match;
    const codes = new Set([
      ...assessments.flatMap((a) => a.reason_codes),
      ...(nearest?.quality_flags ?? []).filter(
        (flag) => flag !== 'sparse_closest_segment' || !peak?.reliable,
      ),
    ]);
    if (!nearest) codes.add('debug_comparison_limit');
    else if (outsideDiscovery) codes.add('outside_discovery_radius');
    else if (!evidence) codes.add('outside_entry_radius');
    if (incomplete) codes.add('incomplete_check');
    response.candidates.push({
      id: place.id,
      name: place.displayName,
      kinds: place.kinds,
      longitude: place.location.longitude,
      latitude: place.location.latitude,
      elevationM: place.elevationM ?? null,
      status: matched ? 'matched' : uncertain ? 'uncertain' : 'rejected',
      defaultMatched: incomplete ? null : defaultSupported.has(place.id),
      distanceM: nearest?.min_horizontal_distance_m ?? null,
      altitudeDifferenceM: nearest?.altitude_difference_m ?? null,
      reasons: [...codes],
      peakMatch: peak
        ? {
            score: peak.weighted_score,
            horizontalDistanceM: peak.horizontal_distance_m,
            recordedElevationM: peak.recorded_altitude_m ?? null,
            altitudeDifferenceM: peak.altitude_difference_m ?? null,
            spatialDistanceM: peak.spatial_distance_m ?? null,
            usesElevation: peak.uses_elevation,
            reliable: peak.reliable,
          }
        : null,
    });
  }
  response.candidates.sort(
    (a, b) =>
      (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
  return {
    ...response,
    status:
      incomplete || reasons.has('debug_comparison_limit')
        ? 'partial'
        : 'complete',
    reasons: [...reasons],
  };
}
