const reasons: Record<string, string> = {
  outside_relation_radius: 'Outside the match radius',
  outside_entry_radius: 'Never entered the encounter radius',
  outside_discovery_radius:
    'Outside experimental discovery radius (shown for default comparison)',
  altitude_mismatch: 'Peak elevation difference exceeds tolerance',
  outside_spatial_tolerance:
    'Combined horizontal and elevation score exceeds 1',
  sparse_closest_segment: 'GPS points are too far apart for a reliable match',
  isolated_gps_sample: 'Only an isolated GPS sample is available',
  hut_vicinity_only: 'Near the hut; entry or overnight stay is not inferred',
  proximity_visit: 'Within the proximity threshold',
  incomplete_check: 'Check incomplete; result is not conclusive',
  debug_comparison_limit: 'Debug measurement budget reached',
  candidate_limit: 'Candidate limit reached; some nearby places are omitted',
  comparison_limit: 'Matching comparison limit reached',
  sample_limit: 'Route sample limit reached',
  mapped_altitude_missing:
    'Mapped elevation unavailable; peak scoring uses horizontal distance only',
  recorded_altitude_missing:
    'Recorded elevation unavailable; peak scoring uses horizontal distance only',
  continuity_unverified: 'Recording continuity could not be verified',
  time_gap: 'Recording gap split the route',
  spatial_gap: 'Large GPS gap split the route',
  speed_gap: 'Implausible speed split the route',
};
export const placeDebugReason = (reason: string) =>
  reasons[reason] ?? reason.replaceAll('_', ' ');
