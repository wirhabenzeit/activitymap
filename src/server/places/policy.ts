import { z } from 'zod';

import { canonicalJson, sha256 } from './catalogue-artifact';

export const MATCHER_VERSION = 'activity-places-matcher-v5';
const metres = z.number().finite().positive().max(2_000);
const policySchema = z
  .strictObject({
    discoveryRadiusM: metres,
    entryRadiusM: metres,
    exitRadiusM: metres,
    peakRadiusM: metres,
    passRadiusM: metres,
    hutRadiusM: metres,
    peakVerticalToleranceM: metres,
    maxTimeGapS: z.number().finite().positive().max(3_600),
    maxSegmentDistanceM: metres,
    maxInterpolationDistanceM: metres,
    maxSpeedMps: z.number().finite().positive().max(200),
    maxSamples: z.number().int().positive().max(1_000_000),
    maxSections: z.number().int().positive().max(10_000),
    maxCandidates: z.number().int().positive().max(5_000),
    maxComparisons: z.number().int().positive().max(20_000_000),
    maxEpisodesPerPlace: z.number().int().positive().max(10_000),
    maxTotalEpisodes: z.number().int().positive().max(20_000),
  })
  .refine(
    (value) =>
      value.entryRadiusM <= value.exitRadiusM &&
      value.exitRadiusM <= value.discoveryRadiusM &&
      Math.max(value.peakRadiusM, value.passRadiusM, value.hutRadiusM) <=
        value.entryRadiusM &&
      value.maxInterpolationDistanceM <= value.maxSegmentDistanceM,
    'Relation radii must fit entry <= exit <= discovery',
  );
export type MatcherPolicy = z.infer<typeof policySchema>;

/** Experimental starting values, not calibrated visit accuracy guarantees. */
export const DEFAULT_MATCHER_POLICY: Readonly<MatcherPolicy> = Object.freeze({
  discoveryRadiusM: 300,
  entryRadiusM: 100,
  exitRadiusM: 150,
  peakRadiusM: 35,
  passRadiusM: 50,
  hutRadiusM: 50,
  peakVerticalToleranceM: 100,
  maxTimeGapS: 120,
  maxSegmentDistanceM: 500,
  maxInterpolationDistanceM: 100,
  maxSpeedMps: 60,
  maxSamples: 100_000,
  maxSections: 2_000,
  maxCandidates: 250,
  maxComparisons: 2_000_000,
  maxEpisodesPerPlace: 100,
  maxTotalEpisodes: 2_000,
});

export function validatePolicy(value: unknown): MatcherPolicy {
  return policySchema.parse(value);
}
export function parametersHash(policy: MatcherPolicy): string {
  return sha256(canonicalJson(validatePolicy(policy)));
}

/** Discontinuities stay local; unfinished processing and unknown reasons block. */
const LOCAL_TRACK_DIAGNOSTICS = new Set([
  'time_gap',
  'speed_gap',
  'spatial_gap',
  'provider_distance_gap',
  'invalid_time_gap',
  'non_increasing_time_gap',
  'invalid_gps_sample',
  'antimeridian_gap',
]);
export function hasBlockingMatchReasons(reasons: Iterable<string>): boolean {
  for (const reason of reasons)
    if (!LOCAL_TRACK_DIAGNOSTICS.has(reason)) return true;
  return false;
}
