import { BATCH_DISCOVERY_VERSION } from './batch-coverage';
import { canonicalJson, sha256 } from './catalogue-artifact';
import {
  DEFAULT_MATCHER_POLICY,
  MATCHER_VERSION,
  parametersHash,
} from './policy';

/** The calibrated server policy. Debug experiments never modify this object. */
export const SERVER_MATCHER_POLICY = Object.freeze({
  ...DEFAULT_MATCHER_POLICY,
  peakRadiusM: 72,
  peakVerticalToleranceM: 72,
});
export const MATCHING_RECIPE = Object.freeze({
  resultFormat: 'activity-place-check-v1',
  matcherVersion: MATCHER_VERSION,
  discoveryVersion: BATCH_DISCOVERY_VERSION,
  parametersHash: parametersHash(SERVER_MATCHER_POLICY),
});
export const MATCHING_RECIPE_HASH = sha256(canonicalJson(MATCHING_RECIPE));
export type MatchingCatalogue = { snapshotId: string | null; revision: string };
export function matchingVersion(
  catalogue: MatchingCatalogue,
  recipe = MATCHING_RECIPE_HASH,
): string {
  return sha256(canonicalJson({ recipe, ...catalogue }));
}
