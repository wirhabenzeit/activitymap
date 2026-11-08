'use node';

import { type Infer } from 'convex/values';

import { activityPlacesResponseSchema } from '../../../../../src/contracts/activity-places';
import { createBatchActivityPlaceMatcher } from '../../../../../src/server/application/batch-activity-places';
import { createActivityClusterQueue } from '../../../../../src/server/places/activity-clusters';
import {
  canonicalJson,
  sha256,
} from '../../../../../src/server/places/catalogue-artifact';
import {
  PLACE_MATCHING_GROUP_ACTIVITIES,
  PLACE_MATCHING_GROUP_MIN_ACTIVITIES,
  PLACE_MATCHING_GROUP_PREPARE_TIME_MS,
  PLACE_MATCHING_GROUP_SAMPLES,
  PLACE_MATCHING_GROUP_SECTIONS,
} from '../../../../../src/server/places/matching-batch-limits';
import {
  MATCHING_RECIPE_HASH,
  SERVER_MATCHER_POLICY,
} from '../../../../../src/server/places/matching-version';
import type { PublishedCatalogue } from '../../../../../src/server/places/published-catalogue-core';
import {
  type PlaceQueryWindow,
  placeQueryWindows,
  uniqueQueryWindows,
} from '../../../../../src/server/places/query-windows';
import { prepareTrack } from '../../../../../src/server/places/track-sections';
import type { CandidatePlace } from '../../../../../src/server/repositories/places';
import { decodeWhole } from '../recording/codec';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { readTiledWindows } from './matching/tiles';
import { claimFields, response } from './matching/validators';

const hash = (input: unknown) => sha256(canonicalJson(input));
const policy = SERVER_MATCHER_POLICY;

function select(items: Doc<'matchingItems'>[], remaining: number) {
  const queue = createActivityClusterQueue(items);
  const selected: Doc<'matchingItems'>[] = [];
  let samples = 0;
  while (
    selected.length < Math.min(PLACE_MATCHING_GROUP_ACTIVITIES, remaining) &&
    samples < PLACE_MATCHING_GROUP_SAMPLES
  ) {
    const item = queue.take(
      selected[0],
      selected.length < PLACE_MATCHING_GROUP_MIN_ACTIVITIES,
    );
    if (!item) break;
    selected.push(item);
    if (item.samples <= policy.maxSamples) samples += item.samples;
  }
  return selected;
}

export const run = internalAction({
  args: claimFields,
  handler: async (ctx, claim): Promise<void> => {
    const workerStarted = performance.now();
    console.log(
      'batch-profile',
      JSON.stringify({ group: claim.group, attempt: claim.attempt }),
    );
    const rssHighWaterAtStartMiB = process.resourceUsage().maxRSS / 1024;
    const rss = () => process.memoryUsage.rss() / (1024 * 1024);
    const heap = () => process.memoryUsage().heapUsed / (1024 * 1024);
    const rssAtStartMiB = rss();
    const heapAtStartMiB = heap();
    let heapPeakMiB = heapAtStartMiB;
    let rssObservedMiB = rss();
    const sampleRss = () => {
      rssObservedMiB = Math.max(rssObservedMiB, rss());
      heapPeakMiB = Math.max(heapPeakMiB, heap());
    };
    let failure = 'inputs_unavailable';
    try {
      const current = await ctx.runQuery(internal.matchingGroups.load, claim);
      if (!current) return;
      const { catalogue, row } = current;
      failure = 'recipe_changed';
      if (catalogue.recipe !== MATCHING_RECIPE_HASH) throw new Error(failure);
      const selected =
        row.mode === 'actual'
          ? select(current.items, current.remaining)
          : current.items;
      failure = 'inputs_unavailable';
      const inputs = await ctx.runQuery(internal.matchingGroups.inputs, {
        ...claim,
        items: selected.map((item) => item._id),
      });
      if (!inputs || inputs.some((input) => !input)) throw new Error(failure);

      const windows: PlaceQueryWindow[] = [];
      const prepared = [];
      const metrics = {
        prepareMs: 0,
        fileMs: 0,
        decodeMs: 0,
        tileMs: 0,
        scoreMs: 0,
        pages: 0,
        tiles: 0,
        scanned: 0,
        compressedBytes: 0,
        rssMiB: 0,
        rssHighWaterAtStartMiB,
        rssObservedMiB: 0,
        samples: 0,
        sections: 0,
        activities: 0,
        rawBytes: 0,
        candidates: 0,
        windows: 0,
        rssAtStartMiB,
        heapAtStartMiB,
        heapPeakMiB: 0,
        rssAfterPrepareMiB: 0,
        heapAfterPrepareMiB: 0,
        rssAfterCatalogueMiB: 0,
        heapAfterCatalogueMiB: 0,
        rssAfterScoreMiB: 0,
        heapAfterScoreMiB: 0,
        workerMs: 0,
      };
      let sampleBudgetUsed = 0;
      let prefetched: Uint8Array[] = [];
      for (const [index, input] of inputs.entries()) {
        if (
          row.mode === 'actual' &&
          prepared.length &&
          (metrics.prepareMs >= PLACE_MATCHING_GROUP_PREPARE_TIME_MS ||
            sampleBudgetUsed >= PLACE_MATCHING_GROUP_SAMPLES ||
            metrics.sections >= PLACE_MATCHING_GROUP_SECTIONS)
        )
          break;
        const { owner, recording } = input!;
        metrics.rawBytes += recording.manifest.uncompressedBytes;
        const item = selected[index]!;
        failure = 'recording_unavailable';
        if (!prefetched.length) {
          // Bound compressed file prefetch independently from sequential tile
          // reads. Decode and prepare one recording at a time.
          const upcoming = [];
          let compressed = 0;
          for (const next of inputs.slice(index, index + 4)) {
            const recording = next!.recording;
            if (
              upcoming.length &&
              compressed + recording.manifest.compressedBytes > 8 * 1024 * 1024
            )
              break;
            upcoming.push(recording);
            compressed += recording.manifest.compressedBytes;
          }
          const fetching = performance.now();
          prefetched = await Promise.all(
            upcoming.map(async (recording) => {
              const blob = await ctx.storage.get(recording.file);
              if (!blob) throw new Error('Recording file missing');
              return new Uint8Array(await blob.arrayBuffer());
            }),
          );
          metrics.fileMs += performance.now() - fetching;
          metrics.compressedBytes += prefetched.reduce(
            (sum, bytes) => sum + bytes.byteLength,
            0,
          );
        }
        const bytes = prefetched.shift()!;
        failure = 'recording_invalid';
        const decoding = performance.now();
        const streams = decodeWhole(bytes, recording.manifest);
        metrics.decodeMs += performance.now() - decoding;
        sampleRss();
        const count = streams.latlng?.data.length ?? 0;
        if (count !== item.samples) throw new Error(failure);
        metrics.samples += count;
        const tooLarge = count > policy.maxSamples;
        const preparing = performance.now();
        // The PostGIS worker's jsonb_build_object projects an absent GPS
        // channel as JSON null. Retain that input contract for its replay.
        const payload =
          recording.sourceVersion.startsWith('postgres-v1:') && !streams.latlng
            ? { ...streams, latlng: null }
            : streams;
        const track = tooLarge ? undefined : prepareTrack(payload, policy);
        if (track) {
          windows.push(
            ...placeQueryWindows(track.geometry, policy.discoveryRadiusM),
          );
          sampleBudgetUsed += track.originalSampleCount;
          metrics.sections += track.sections.length;
        }
        metrics.prepareMs += performance.now() - preparing;
        sampleRss();
        prepared.push({ item, owner, recording, track, tooLarge });
      }
      failure = 'catalogue_incomplete';
      metrics.activities = prepared.length;
      metrics.rssAfterPrepareMiB = rss();
      metrics.heapAfterPrepareMiB = heap();
      const scoped = uniqueQueryWindows(windows);
      metrics.windows = scoped.length;
      const read = await readTiledWindows(
        ctx,
        {
          dataset: catalogue.snapshotId,
          windows: scoped,
          // Independent cache namespace for controlled uncached profile trials.
          nonce: row.mode === 'profile-cold' ? String(claim.group) : undefined,
        },
        row.parallelism === 4 ? 4 : 1,
      );
      metrics.tileMs = read.elapsedMs;
      metrics.pages = read.pages;
      metrics.tiles = read.tiles;
      metrics.scanned = read.scanned;
      metrics.candidates = read.places.length;
      sampleRss();
      metrics.rssAfterCatalogueMiB = rss();
      metrics.heapAfterCatalogueMiB = heap();

      failure = 'matching_failed';
      const scoring = performance.now();
      const places = read.places as CandidatePlace[];
      const candidateHash = hash(
        [...places].sort((a, b) => a.id.localeCompare(b.id)),
      );
      const matcher = createBatchActivityPlaceMatcher({
        snapshot: {
          catalogue: JSON.parse(catalogue.artifact) as PublishedCatalogue,
          revision: catalogue.revision,
          places,
          windows: scoped,
        },
        policy,
      });
      const writes = [];
      for (const { item, owner, recording, track, tooLarge } of prepared) {
        const result = activityPlacesResponseSchema.parse(
          await matcher.match(
            {
              userId: owner.userId,
              activityId: recording.key,
              input: {
                payload: null,
                generation: recording.generation,
                revision: String(recording.revision),
                too_large: tooLarge,
              },
            },
            track,
          ),
        ) as Infer<typeof response>;
        // Only the replay comparison hash projects the frozen Postgres
        // revision. The persisted result always identifies the hosted file.
        const comparison = { ...result, streamRevision: item.originalRevision };
        writes.push({
          item: item._id,
          recording: recording._id,
          sourceVersion: recording.sourceVersion,
          result,
          hash: hash(comparison),
        });
      }
      metrics.scoreMs = performance.now() - scoring;
      sampleRss();
      metrics.rssObservedMiB = rssObservedMiB;
      metrics.rssMiB = process.resourceUsage().maxRSS / 1024;
      metrics.heapPeakMiB = heapPeakMiB;
      metrics.rssAfterScoreMiB = rss();
      metrics.heapAfterScoreMiB = heap();
      metrics.workerMs = performance.now() - workerStarted;

      // The synthetic recovery trial interrupts after scoring and before the
      // checkpoint, leaving the normal lease-expiry recovery in charge.
      if (row.interruptFirstAttempt && claim.attempt === 1) return;
      failure = 'commit_fenced_or_oversized';
      if (
        Buffer.byteLength(JSON.stringify(writes)) > 2_000_000 ||
        !(await ctx.runMutation(internal.matchingGroups.commit, {
          ...claim,
          snapshotId: catalogue.snapshotId,
          revision: catalogue.revision,
          recipe: catalogue.recipe,
          windows: scoped,
          candidateHash,
          metrics,
          writes,
        }))
      )
        throw new Error(failure);
    } catch {
      await ctx.runMutation(internal.matchingGroups.fail, {
        ...claim,
        reason: failure,
      });
    }
  },
});
