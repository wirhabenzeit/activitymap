import type { MatcherPolicy } from './policy';
import type { CandidatePlace } from './run-types';
import { peakSpatialScore } from './spatial-score';
import type { PlaceEncounterFragment, PlaceRelation } from './types';

export interface ClassificationContext {
  hasNeighbouringSample: boolean;
  reliableClosest: boolean;
}

/** Proximity-based visits, measured only on valid recorded fragments. */
export function classifyEncounter(
  place: CandidatePlace,
  encounter: Pick<
    PlaceEncounterFragment,
    'min_horizontal_distance_m' | 'recorded_altitude_m' | 'peak_match'
  >,
  context: ClassificationContext,
  policy: MatcherPolicy,
): PlaceEncounterFragment['relation_assessments'] {
  const assessments: PlaceEncounterFragment['relation_assessments'] = [];
  function visit(
    relation: PlaceRelation,
    radius: number,
    checkElevation = false,
  ) {
    const add = (
      status: 'supported' | 'nearby' | 'uncertain',
      reason: string,
    ) => assessments.push({ relation, status, reason_codes: [reason] });
    const peak = checkElevation ? encounter.peak_match : undefined;
    const distance =
      peak?.horizontal_distance_m ?? encounter.min_horizontal_distance_m;
    if (encounter.min_horizontal_distance_m > radius)
      add('nearby', 'outside_relation_radius');
    else if (!(peak?.reliable ?? context.reliableClosest))
      add('uncertain', 'sparse_closest_segment');
    else if (!context.hasNeighbouringSample)
      add('uncertain', 'isolated_gps_sample');
    else if (
      checkElevation &&
      (peak?.weighted_score ??
        peakSpatialScore(
          distance,
          encounter.recorded_altitude_m,
          place.elevationM,
          policy,
        ).score) > 1
    )
      add('nearby', 'outside_spatial_tolerance');
    else
      add(
        'supported',
        relation === 'arrived_at_hut' ? 'hut_vicinity_only' : 'proximity_visit',
      );
  }
  if (place.kinds.includes('peak'))
    visit('reached_peak', policy.peakRadiusM, true);
  if (place.kinds.includes('pass')) visit('visited_pass', policy.passRadiusM);
  if (place.kinds.includes('hut')) visit('arrived_at_hut', policy.hutRadiusM);
  return assessments;
}
