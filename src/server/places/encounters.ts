import { z } from 'zod';

import { canonicalJson } from './catalogue-artifact';
import { classifyEncounter } from './classify';
import {
  type MatcherPolicy,
  hasBlockingMatchReasons,
  validatePolicy,
} from './policy';
import type { CandidatePlace, PlaceMatch } from './run-types';
import {
  type PreparedSample,
  type PreparedSection,
  type PreparedTrack,
  relativeVectorM,
} from './track-sections';
import {
  type PlaceEncounterFragment,
  type PlaceEncounterPause,
  type PlaceKind,
  buildActivityPlaceEvidence,
  placeKindSchema,
  placePointSchema,
  placeSubtypeSchema,
} from './types';

const candidateSchema = z
  .strictObject({
    id: z.string().min(1),
    displayName: z.string().min(1),
    kinds: z.array(placeKindSchema).min(1).max(3),
    subtypes: z.array(placeSubtypeSchema).min(1).max(5),
    location: placePointSchema,
    elevationM: z.number().finite().optional(),
  })
  .superRefine((place, context) => {
    const kinds = new Set<PlaceKind>(
      place.subtypes.map((subtype) =>
        subtype === 'peak'
          ? 'peak'
          : subtype === 'natural_saddle' || subtype === 'road_trail_pass'
            ? 'pass'
            : 'hut',
      ),
    );
    if (
      kinds.size !== place.kinds.length ||
      place.kinds.some((kind) => !kinds.has(kind)) ||
      new Set(place.subtypes).size !== place.subtypes.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Candidate kinds/subtypes must be unique and consistent',
      });
    }
  });

interface Closest {
  reference: PlaceEncounterFragment['closest'];
  distance: number;
  first: PreparedSample;
  last: PreparedSample;
  fraction: number;
}
function closestOnSegment(
  first: PreparedSample,
  last: PreparedSample,
  place: CandidatePlace,
): Closest {
  const a = relativeVectorM(first.point, place.location);
  const b = relativeVectorM(last.point, place.location);
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared));
  const reference: PlaceEncounterFragment['closest'] =
    fraction === 0
      ? { kind: 'sample', index: first.index }
      : fraction === 1
        ? { kind: 'sample', index: last.index }
        : {
            kind: 'segment',
            start_index: first.index,
            end_index: last.index,
            fraction,
          };
  return {
    reference,
    distance: Math.hypot(a.x + dx * fraction, a.y + dy * fraction),
    first,
    last,
    fraction,
  };
}
function interpolate(
  closest: Closest,
  key: 'elapsedS' | 'providerDistanceM' | 'altitudeM' | 'sectionDistanceM',
) {
  const before = closest.first[key];
  const after = closest.last[key];
  if (closest.fraction === 0) return before;
  if (closest.fraction === 1) return after;
  return before === undefined || after === undefined
    ? undefined
    : before + (after - before) * closest.fraction;
}
interface ActiveEpisode {
  start: PreparedSample;
  closest: Closest;
}

function episodeEvidence(
  active: ActiveEpisode,
  end: PreparedSample,
  section: PreparedSection,
  track: PreparedTrack,
  place: CandidatePlace,
  policy: MatcherPolicy,
): PlaceEncounterFragment {
  const { start, closest } = active;
  const elapsed = interpolate(closest, 'elapsedS');
  const providerDistance = interpolate(closest, 'providerDistanceM');
  const altitude = interpolate(closest, 'altitudeM');
  const reliableClosest =
    closest.reference.kind === 'sample' ||
    closest.last.sectionDistanceM - closest.first.sectionDistanceM <=
      policy.maxInterpolationDistanceM;
  const useProvider =
    start.providerDistanceM !== undefined &&
    end.providerDistanceM !== undefined &&
    providerDistance !== undefined;
  const evidence = {
    section_id: section.id,
    start_gps_index: start.index,
    end_gps_index: end.index,
    closest: closest.reference,
    ...(start.elapsedS !== undefined &&
    end.elapsedS !== undefined &&
    elapsed !== undefined
      ? {
          elapsed_s: {
            start: start.elapsedS,
            closest: elapsed,
            end: end.elapsedS,
          },
        }
      : {}),
    route_distance_m: useProvider
      ? {
          basis: 'provider_distance' as const,
          start: start.providerDistanceM!,
          closest: providerDistance,
          end: end.providerDistanceM!,
        }
      : {
          basis: 'section_gps' as const,
          start: start.sectionDistanceM,
          closest: interpolate(closest, 'sectionDistanceM')!,
          end: end.sectionDistanceM,
        },
    min_horizontal_distance_m: closest.distance,
    source: {
      point: { ...place.location },
      ...(place.elevationM === undefined
        ? {}
        : { mapped_elevation_m: place.elevationM }),
    },
    ...(altitude === undefined ? {} : { recorded_altitude_m: altitude }),
    ...(altitude === undefined || place.elevationM === undefined
      ? {}
      : { altitude_difference_m: altitude - place.elevationM }),
    quality_flags: [
      ...new Set([
        ...track.qualityFlags,
        ...(!section.continuousTime ? ['continuity_unverified'] : []),
        ...(!reliableClosest ? ['sparse_closest_segment'] : []),
        ...(place.elevationM === undefined ? ['mapped_altitude_missing'] : []),
        ...(altitude === undefined ? ['recorded_altitude_missing'] : []),
        ...(place.kinds.includes('hut') ? ['hut_vicinity_only'] : []),
      ]),
    ].sort(),
  };
  return {
    ...evidence,
    relation_assessments: classifyEncounter(
      place,
      evidence,
      {
        hasNeighbouringSample: section.samples.length >= 2,
        reliableClosest,
      },
      policy,
    ),
  };
}

/** Join nearby pause endpoints without connecting geometry or reclassifying. */
function recordingPauses(
  fragments: PlaceEncounterFragment[],
  sections: Map<number, PreparedSection>,
  place: CandidatePlace,
  policy: MatcherPolicy,
): PlaceEncounterPause[] {
  const pauses: PlaceEncounterPause[] = [];
  for (let index = 1; index < fragments.length; index++) {
    const before = fragments[index - 1]!;
    const after = fragments[index]!;
    const sectionBefore = sections.get(before.section_id)!;
    const sectionAfter = sections.get(after.section_id)!;
    const end = sectionBefore.samples.at(-1)!;
    const start = sectionAfter.samples[0]!;
    if (
      sectionAfter.breakBefore !== 'time_gap' ||
      sectionAfter.id !== sectionBefore.id + 1 ||
      before.end_gps_index !== end.index ||
      after.start_gps_index !== start.index ||
      start.index !== end.index + 1 ||
      end.elapsedS === undefined ||
      start.elapsedS === undefined ||
      start.elapsedS - end.elapsedS <= policy.maxTimeGapS
    )
      continue;
    const a = relativeVectorM(end.point, place.location);
    const b = relativeVectorM(start.point, place.location);
    const beforeDistance = Math.hypot(a.x, a.y);
    const afterDistance = Math.hypot(b.x, b.y);
    if (
      beforeDistance > policy.entryRadiusM ||
      afterDistance > policy.entryRadiusM
    )
      continue;
    // A distance stream can record travel while GPS is absent. Do not hide a
    // possible departure/return when it advances farther than the exit radius.
    if (
      end.providerDistanceM !== undefined &&
      start.providerDistanceM !== undefined &&
      (start.providerDistanceM < end.providerDistanceM ||
        start.providerDistanceM - end.providerDistanceM > policy.exitRadiusM)
    )
      continue;
    pauses.push({
      before_gps_index: end.index,
      after_gps_index: start.index,
      elapsed_s: { start: end.elapsedS, end: start.elapsedS },
      before_distance_m: beforeDistance,
      after_distance_m: afterDistance,
      radius_m: policy.entryRadiusM,
    });
  }
  return pauses;
}

/** Hysteresis fragments retain continuous-section evidence inside encounters. */
export function matchEncounters(
  track: PreparedTrack,
  candidates: CandidatePlace[],
  inputPolicy: MatcherPolicy,
): { matches: PlaceMatch[]; partial: boolean; reasons: string[] } {
  const policy = validatePolicy(inputPolicy);
  const reasons = new Set(track.reasons);
  const matches: PlaceMatch[] = [];
  const sections = new Map(
    track.sections.map((section) => [section.id, section]),
  );
  if (candidates.length > policy.maxCandidates) {
    return {
      matches,
      partial: true,
      reasons: [...reasons, 'candidate_limit'].sort(),
    };
  }
  const unique = new Map<string, CandidatePlace>();
  for (const input of candidates) {
    const candidate = candidateSchema.parse(input);
    const existing = unique.get(candidate.id);
    if (existing && canonicalJson(existing) !== canonicalJson(candidate))
      throw new Error(`Conflicting duplicate candidate: ${candidate.id}`);
    unique.set(candidate.id, candidate);
  }
  let comparisons = 0,
    totalEpisodes = 0;
  let stopped = false;
  for (const place of [...unique.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    // Limits still bound raw fragments, including fragments grouped by a pause.
    const episodes: PlaceEncounterFragment[] = [];
    let placeStopped = false;
    for (const section of track.sections) {
      let active: ActiveEpisode | undefined;
      let lastOutside: PreparedSample | undefined;
      const emit = (end: PreparedSample) => {
        if (!active) return;
        if (episodes.length >= policy.maxEpisodesPerPlace) {
          reasons.add('place_episode_limit');
          placeStopped = true;
          active = undefined;
          return;
        }
        if (totalEpisodes >= policy.maxTotalEpisodes) {
          reasons.add('total_episode_limit');
          stopped = true;
          active = undefined;
          return;
        }
        episodes.push(
          episodeEvidence(active, end, section, track, place, policy),
        );
        totalEpisodes++;
        active = undefined;
      };
      for (let index = 0; index < section.samples.length; index++) {
        if (comparisons >= policy.maxComparisons) {
          reasons.add('comparison_limit');
          stopped = true;
          break;
        }
        comparisons++;
        const last = section.samples[index]!;
        const first = section.samples[Math.max(0, index - 1)]!;
        const closest = closestOnSegment(first, last, place);
        const vector = relativeVectorM(last.point, place.location);
        const endDistance = Math.hypot(vector.x, vector.y);
        if (!active && closest.distance <= policy.entryRadiusM)
          active = { start: lastOutside ?? first, closest };
        else if (active && closest.distance < active.closest.distance)
          active.closest = closest;
        if (endDistance > policy.exitRadiusM) {
          emit(last);
          lastOutside = last;
        }
        if (placeStopped || stopped) break;
      }
      if (!stopped && !placeStopped && active) emit(section.samples.at(-1)!);
      if (placeStopped || stopped) break;
    }
    if (episodes.length)
      matches.push({
        placeId: place.id,
        evidence: buildActivityPlaceEvidence(
          episodes,
          recordingPauses(episodes, sections, place, policy),
        ),
      });
    if (stopped) break;
  }
  return {
    matches,
    partial: track.partial || hasBlockingMatchReasons(reasons),
    reasons: [...reasons].sort(),
  };
}
