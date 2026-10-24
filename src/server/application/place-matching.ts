import 'server-only';

import {
  PLACE_MATCHING_CANDIDATE_MULTIPLIER,
  createActivityClusterQueue,
} from '~/server/places/activity-clusters';
import {
  type MatchingCatalogue,
  SERVER_MATCHER_POLICY,
} from '~/server/places/matching-version';
import {
  type PlaceQueryWindow,
  placeQueryWindows,
  uniqueQueryWindows,
} from '~/server/places/query-windows';
import {
  type PreparedTrack,
  prepareTrack,
} from '~/server/places/track-sections';
import { loadBatchPlaceCatalogue } from '~/server/repositories/batch-place-catalogue';
import {
  type MatchingCandidate,
  type PlaceMatchingRepository,
  createPlaceMatchingRepository,
} from '~/server/repositories/place-matching';

import {
  type PlaceMatchingSnapshot,
  createBatchActivityPlaceMatcher,
} from './batch-activity-places';
import type { ActivityPlaceInput } from './match-activity-places';

export const PLACE_MATCHING_BATCH_SIZE = 500;
export const PLACE_MATCHING_TIME_MS = 40_000;
export const PLACE_MATCHING_GROUP_ACTIVITIES = 100;
export const PLACE_MATCHING_GROUP_MIN_ACTIVITIES = 25;
export const PLACE_MATCHING_GROUP_SAMPLES = 100_000;
export const PLACE_MATCHING_GROUP_SECTIONS = 1_000;
type PreparedCandidate = {
  candidate: MatchingCandidate;
  input: ActivityPlaceInput;
  track?: PreparedTrack;
};
export type PlaceMatchingResult = {
  selected: number;
  saved: number;
  failed: number;
  superseded: number;
  groups: number;
  placesLoaded: number;
  elapsedMs: number;
  stopReason:
    | 'complete'
    | 'batch_limit'
    | 'deadline'
    | 'busy'
    | 'unavailable'
    | 'inputs_changed';
};
/** A checkpoint is the atomically saved check, including empty/partial results.
 * Failed inputs back off; version changes bypass that backoff automatically. */
export async function processPlaceMatching(
  options: {
    activityLimit?: number;
    timeMs?: number;
    activityIds?: string[];
    repository?: PlaceMatchingRepository;
    loadSnapshot?: (selection: {
      windows: readonly PlaceQueryWindow[];
    }) => Promise<PlaceMatchingSnapshot>;
    clock?: () => number;
  } = {},
): Promise<PlaceMatchingResult> {
  const activityLimit = options.activityLimit ?? PLACE_MATCHING_BATCH_SIZE;
  const timeMs = options.timeMs ?? PLACE_MATCHING_TIME_MS;
  if (
    !Number.isInteger(activityLimit) ||
    activityLimit < 1 ||
    activityLimit > 2_000 ||
    !Number.isFinite(timeMs) ||
    timeMs < 1 ||
    timeMs > PLACE_MATCHING_TIME_MS ||
    (options.activityIds &&
      (!options.activityIds.length ||
        options.activityIds.length > 2_000 ||
        options.activityIds.some((id) => !/^[1-9][0-9]*$/.test(id))))
  )
    throw new Error('Invalid matching batch limits');
  const clock = options.clock ?? Date.now,
    started = clock();
  const repository = options.repository ?? createPlaceMatchingRepository();
  const result: PlaceMatchingResult = {
    selected: 0,
    saved: 0,
    failed: 0,
    superseded: 0,
    groups: 0,
    placesLoaded: 0,
    elapsedMs: 0,
    stopReason: 'complete',
  };
  const token = await repository.acquire();
  if (!token)
    return { ...result, stopReason: 'busy', elapsedMs: clock() - started };
  try {
    const current = await repository.catalogue();
    if (!current.snapshotId) {
      result.stopReason = 'unavailable';
      return result;
    }
    // Avoid loading the entire catalogue when this cycle has no pending work.
    const candidates = await repository.candidates(
      current,
      activityLimit * PLACE_MATCHING_CANDIDATE_MULTIPLIER,
      options.activityIds,
    );
    if (!candidates.length) return result;
    const queue = createActivityClusterQueue(candidates);
    const failed = async (candidate: MatchingCandidate) => {
      result.failed++;
      if (!(await repository.commit(token, current, candidate, null)))
        result.stopReason = 'inputs_changed';
    };
    while (queue.size && result.selected < activityLimit) {
      const group: PreparedCandidate[] = [];
      const windows: PlaceQueryWindow[] = [];
      let seed: MatchingCandidate | undefined;
      let samples = 0,
        sections = 0;
      // Metadata selection stays large; raw GPS and prepared samples are retained
      // only for this bounded group. Every stream is read and prepared once.
      while (
        queue.size &&
        result.selected < activityLimit &&
        group.length < PLACE_MATCHING_GROUP_ACTIVITIES &&
        samples < PLACE_MATCHING_GROUP_SAMPLES &&
        sections < PLACE_MATCHING_GROUP_SECTIONS
      ) {
        if (clock() - started >= timeMs) {
          result.stopReason = 'deadline';
          break;
        }
        const candidate = queue.take(
          seed,
          group.length < PLACE_MATCHING_GROUP_MIN_ACTIVITIES,
        );
        if (!candidate) break;
        seed ??= candidate;
        result.selected++;
        try {
          const input = await repository.readInput(candidate);
          if (!input) {
            result.superseded++;
            continue;
          }
          const track =
            input.too_large || input.payload == null
              ? undefined
              : prepareTrack(input.payload, SERVER_MATCHER_POLICY);
          if (track) {
            windows.push(
              ...placeQueryWindows(
                track.geometry,
                SERVER_MATCHER_POLICY.discoveryRadiusM,
              ),
            );
            samples += track.originalSampleCount;
            sections += track.sections.length;
          }
          group.push({ candidate, input: { ...input, payload: null }, track });
        } catch {
          await failed(candidate);
        }
        if (result.stopReason !== 'complete') break;
      }
      if (result.stopReason !== 'complete') break;
      if (!group.length) continue;
      if (clock() - started >= timeMs) {
        result.stopReason = 'deadline';
        break;
      }
      const selection = { windows: uniqueQueryWindows(windows) };
      const snapshot = await (
        options.loadSnapshot ??
        ((selection) => loadBatchPlaceCatalogue(undefined, selection))
      )(selection);
      const catalogue: MatchingCatalogue = {
        snapshotId: snapshot.catalogue.manifest.catalogue_snapshot_id,
        revision: snapshot.revision ?? '',
      };
      if (
        catalogue.snapshotId !== current.snapshotId ||
        catalogue.revision !== current.revision
      ) {
        result.stopReason = 'inputs_changed';
        break;
      }
      result.groups++;
      result.placesLoaded += snapshot.places.length;
      const matcher = createBatchActivityPlaceMatcher({
        snapshot,
        policy: SERVER_MATCHER_POLICY,
      });
      for (const { candidate, input, track } of group) {
        if (clock() - started >= timeMs) {
          result.stopReason = 'deadline';
          break;
        }
        let response;
        try {
          response = await matcher.match(
            {
              userId: candidate.userId,
              activityId: candidate.activityId,
              input,
            },
            track,
          );
        } catch {
          await failed(candidate);
          if (result.stopReason !== 'complete') break;
          continue;
        }
        if (clock() - started >= timeMs) {
          result.stopReason = 'deadline';
          break;
        }
        if (await repository.commit(token, catalogue, candidate, response))
          result.saved++;
        else {
          result.superseded++;
          result.stopReason = 'inputs_changed';
          break;
        }
      }
      if (result.stopReason !== 'complete') break;
    }
    if (result.stopReason === 'complete' && result.selected === activityLimit)
      result.stopReason = 'batch_limit';
    return result;
  } finally {
    await repository.release(token);
    result.elapsedMs = Math.max(0, clock() - started);
  }
}
