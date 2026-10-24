import 'server-only';

import {
  PLACE_MATCHING_CANDIDATE_MULTIPLIER,
  createActivityClusterQueue,
} from '~/server/places/activity-clusters';
import { SERVER_MATCHER_POLICY } from '~/server/places/matching-version';
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
  type MatchingWrite,
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
export const PLACE_MATCHING_GROUP_ACTIVITIES = PLACE_MATCHING_BATCH_SIZE;
export const PLACE_MATCHING_GROUP_MIN_ACTIVITIES = 25;
export const PLACE_MATCHING_GROUP_PREPARE_TIME_MS = 5_000;
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
  inputBatches: number;
  commitBatches: number;
  inputReadMs: number;
  catalogueLoadMs: number;
  matchingMs: number;
  commitMs: number;
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
    inputBatches: 0,
    commitBatches: 0,
    inputReadMs: 0,
    catalogueLoadMs: 0,
    matchingMs: 0,
    commitMs: 0,
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
    // Only counts, scoped to this run and exact input identity. Deferred tracks
    // are sized once; payload reads still recheck current authorization/inputs.
    const inputSizes = new Map<string, number>();
    const save = async (writes: MatchingWrite[]) => {
      if (!writes.length) return;
      const before = clock();
      const committed = await repository.commitMany(token, current, writes);
      result.commitMs += clock() - before;
      result.commitBatches++;
      const ids = new Set(committed.committed);
      result.saved += writes.filter(
        (write) => write.response && ids.has(write.candidate.activityId),
      ).length;
      result.superseded += writes.length - ids.size;
      if (committed.fenceLost || ids.size !== writes.length)
        result.stopReason = 'inputs_changed';
    };
    while (queue.size && result.selected < activityLimit) {
      if (clock() - started >= timeMs) {
        result.stopReason = 'deadline';
        break;
      }
      const planned: MatchingCandidate[] = [];
      let seed: MatchingCandidate | undefined;
      while (
        queue.size &&
        planned.length <
          Math.min(
            PLACE_MATCHING_GROUP_ACTIVITIES,
            activityLimit - result.selected,
          )
      ) {
        const candidate = queue.take(
          seed,
          planned.length < PLACE_MATCHING_GROUP_MIN_ACTIVITIES,
        );
        if (!candidate) break;
        seed ??= candidate;
        planned.push(candidate);
      }
      const reading = clock();
      const batch = await repository.readInputs(
        planned,
        PLACE_MATCHING_GROUP_SAMPLES,
        inputSizes,
      );
      result.inputReadMs += clock() - reading;
      result.inputBatches++;
      if (batch.consumed < 1 || batch.consumed > planned.length)
        throw new Error('Invalid matching input progress');
      queue.restore(planned.slice(batch.consumed));
      const selected = planned.slice(0, batch.consumed);
      result.selected += selected.length;
      let next = 0;
      while (next < selected.length) {
        if (clock() - started >= timeMs) {
          result.stopReason = 'deadline';
          break;
        }
        const group: PreparedCandidate[] = [];
        const windows: PlaceQueryWindow[] = [];
        const writes: MatchingWrite[] = [];
        let samples = 0,
          sections = 0;
        const groupStarted = clock();
        const prepareTimeMs = Math.min(
          PLACE_MATCHING_GROUP_PREPARE_TIME_MS,
          Math.max(0, (timeMs - (groupStarted - started)) / 2),
        );
        while (
          next < selected.length &&
          samples < PLACE_MATCHING_GROUP_SAMPLES &&
          sections < PLACE_MATCHING_GROUP_SECTIONS
        ) {
          if (
            (group.length || writes.length) &&
            clock() - groupStarted >= prepareTimeMs
          )
            break;
          if (clock() - started >= timeMs) {
            result.stopReason = 'deadline';
            break;
          }
          const candidate = selected[next++]!;
          const input = batch.inputs.get(candidate.activityId);
          // Release raw payloads as soon as they have been prepared. The input
          // sizing query bounds retained raw GPS even when 500 routes are nearby.
          // eslint-disable-next-line drizzle/enforce-delete-with-where -- release an in-memory Map entry
          batch.inputs.delete(candidate.activityId);
          if (!input) {
            result.superseded++;
            continue;
          }
          try {
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
            group.push({
              candidate,
              input: { ...input, payload: null },
              track,
            });
          } catch {
            result.failed++;
            writes.push({ candidate, response: null });
          }
        }
        result.matchingMs += clock() - groupStarted;
        if (group.length && result.stopReason === 'complete') {
          const loading = clock();
          const snapshot = await (
            options.loadSnapshot ??
            ((selection) => loadBatchPlaceCatalogue(undefined, selection))
          )({ windows: uniqueQueryWindows(windows) });
          result.catalogueLoadMs += clock() - loading;
          if (
            snapshot.catalogue.manifest.catalogue_snapshot_id !==
              current.snapshotId ||
            (snapshot.revision ?? '') !== current.revision
          ) {
            result.stopReason = 'inputs_changed';
            break;
          }
          result.groups++;
          result.placesLoaded += snapshot.places.length;
          const matching = clock();
          const matcher = createBatchActivityPlaceMatcher({
            snapshot,
            policy: SERVER_MATCHER_POLICY,
          });
          for (const { candidate, input, track } of group) {
            if (clock() - started >= timeMs) {
              result.stopReason = 'deadline';
              break;
            }
            try {
              writes.push({
                candidate,
                response: await matcher.match(
                  {
                    userId: candidate.userId,
                    activityId: candidate.activityId,
                    input,
                  },
                  track,
                ),
              });
            } catch {
              result.failed++;
              writes.push({ candidate, response: null });
            }
          }
          result.matchingMs += clock() - matching;
        }
        // Flush already computed results even at the work deadline. Otherwise
        // large groups could repeatedly compute without checkpointing progress.
        await save(writes);
        if (result.stopReason !== 'complete') break;
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
