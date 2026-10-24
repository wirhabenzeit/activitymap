import { surfaceDistanceM } from './track-sections';
import type { PlacePoint } from './types';

export type ActivityLocationHint = {
  bounds?: number[] | null;
  start?: number[] | null;
};

/** Hints only choose work order. Actual stream geometry still scopes every
 * place query, so absent or inaccurate summary geometry cannot hide matches. */
export function activityClusterPoint(
  hint: ActivityLocationHint,
): PlacePoint | undefined {
  const box = hint.bounds;
  if (
    box?.length === 4 &&
    box.every(Number.isFinite) &&
    box[0]! >= -180 &&
    box[2]! <= 180 &&
    box[1]! >= -90 &&
    box[3]! <= 90 &&
    box[0]! <= box[2]! &&
    box[1]! <= box[3]! &&
    box[2]! - box[0]! <= 180 &&
    !box.every((value) => value === 0)
  )
    return {
      longitude: (box[0]! + box[2]!) / 2,
      latitude: (box[1]! + box[3]!) / 2,
    };
  const start = hint.start;
  if (
    start?.length === 2 &&
    start.every(Number.isFinite) &&
    Math.abs(start[0]!) <= 90 &&
    Math.abs(start[1]!) <= 180
  )
    return { latitude: start[0]!, longitude: start[1]! };
  return undefined;
}

export const ACTIVITY_CLUSTER_RADIUS_M = 25_000;
export const PLACE_MATCHING_CANDIDATE_MULTIPLIER = 4;

/** Each group starts in freshness order, then takes the seed's nearest
 * neighbours from a bounded metadata pool. Larger groups stay within a fixed
 * radius; small sparse groups can fill without creating singleton queries. */
export function createActivityClusterQueue<
  T extends { locationHint?: ActivityLocationHint },
>(candidates: readonly T[]) {
  const remaining = candidates.map((candidate) => ({
    candidate,
    point: activityClusterPoint(candidate.locationHint ?? {}),
  }));
  return {
    get size() {
      return remaining.length;
    },
    take(seed?: T, fillSparseGroup = false): T | undefined {
      if (!remaining.length) return undefined;
      if (seed === undefined) return remaining.shift()!.candidate;
      const origin = activityClusterPoint(seed.locationHint ?? {});
      let selected = -1;
      let nearest = fillSparseGroup ? Infinity : ACTIVITY_CLUSTER_RADIUS_M;
      for (let index = 0; index < remaining.length; index++) {
        const point = remaining[index]!.point;
        if (!origin) {
          if (!point) {
            selected = index;
            break;
          }
        } else if (point) {
          const distance = surfaceDistanceM(origin, point);
          if (distance <= nearest && (selected === -1 || distance < nearest)) {
            nearest = distance;
            selected = index;
          }
        }
      }
      if (selected < 0 && fillSparseGroup) selected = 0;
      return selected < 0
        ? undefined
        : remaining.splice(selected, 1)[0]!.candidate;
    },
  };
}
