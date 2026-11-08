import type { MatcherPolicy } from './policy';

/** Dimensionless peak distance; missing elevation explicitly falls back to 2D. */
export function peakSpatialScore(
  horizontalM: number,
  recordedAltitudeM: number | undefined,
  mappedAltitudeM: number | undefined,
  policy: MatcherPolicy,
) {
  const altitudeDifferenceM =
    recordedAltitudeM === undefined || mappedAltitudeM === undefined
      ? undefined
      : recordedAltitudeM - mappedAltitudeM;
  return {
    score: Math.hypot(
      horizontalM / policy.peakRadiusM,
      altitudeDifferenceM === undefined
        ? 0
        : altitudeDifferenceM / policy.peakVerticalToleranceM,
    ),
    usesElevation: altitudeDifferenceM !== undefined,
    altitudeDifferenceM,
    spatialDistanceM:
      altitudeDifferenceM === undefined
        ? undefined
        : Math.hypot(horizontalM, altitudeDifferenceM),
  };
}
