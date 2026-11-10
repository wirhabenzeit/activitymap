'use node';

import { v } from 'convex/values';

import { activityPlacesResponseSchema } from '../../src/contracts/activity-places';
import { createBatchActivityPlaceMatcher } from '../../src/server/application/batch-activity-places';
import {
  SERVER_MATCHER_POLICY,
  matchingVersion,
} from '../../src/server/places/matching-version';
import type { PublishedCatalogue } from '../../src/server/places/published-catalogue-core';
import {
  type PlaceQueryWindow,
  placeQueryWindows,
  uniqueQueryWindows,
} from '../../src/server/places/query-windows';
import type { CandidatePlace } from '../../src/server/places/run-types';
import {
  type PreparedTrack,
  prepareTrack,
} from '../../src/server/places/track-sections';
import { readMatchingTiles } from '../matching/tiles';
import { MAX_RECORDING_BYTES, decodeWhole } from '../recording/codec';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';

/**
 * The shadow matcher's worker: the application matcher, coverage and track
 * preparation the Postgres worker uses, reading recordings from file storage
 * and candidate places from the copied catalogue by tile.
 *
 * A group is a prefix of the activities read ahead, kept small: the lab
 * (#495) saw over 600 MiB with large groups and about 230 MiB with these
 * limits. A group whose tile, page or result budget is exceeded is retried
 * as its first activity alone; an activity that still fails is recorded on
 * the run and skipped.
 */
const GROUP_ACTIVITIES = 12;
const GROUP_SAMPLES = 25_000;
const GROUP_RAW_BYTES = 4 * 1024 * 1024;

const policy = SERVER_MATCHER_POLICY;

type Prepared = {
  key: string;
  id: string;
  recording: { id: Id<'recordings'>; generation: string; revision: string };
  track: PreparedTrack | undefined;
  tooLarge: boolean;
};

export const run = internalAction({
  args: { run: v.id('shadowMatchRuns') },
  handler: async (ctx, args): Promise<void> => {
    try {
      const batch = await ctx.runQuery(internal.shadowMatching.load, args);
      if (!batch) return;
      // Results are comparable only if this rowset and recipe are the ones
      // the owner's copied results were computed with.
      if (
        matchingVersion({
          snapshotId: batch.catalogue.snapshotId,
          revision: batch.catalogue.revision,
        }) !== batch.matchingVersion
      )
        throw new Error(
          'The catalogue rowset or matching recipe differs from the owner’s',
        );
      const metadata = await ctx.storage.get(batch.catalogue.metadata);
      if (!metadata) throw new Error('Catalogue metadata missing');
      const catalogue = JSON.parse(await metadata.text()) as PublishedCatalogue;

      // The group: a prefix of the read-ahead within the limits. Activities
      // without a recording only move the position.
      const group: typeof batch.items = [];
      let taken = 0;
      let skipped = 0;
      let samples = 0;
      let rawBytes = 0;
      for (const item of batch.items) {
        if (!item.recording || item.id === null) {
          skipped++;
          taken++;
          continue;
        }
        const count = item.recording.manifest.counts.latlng ?? 0;
        const raw = item.recording.manifest.uncompressedBytes;
        if (
          group.length > 0 &&
          (group.length >= GROUP_ACTIVITIES ||
            samples + count > GROUP_SAMPLES ||
            rawBytes + raw > GROUP_RAW_BYTES)
        )
          break;
        group.push(item);
        samples += count;
        rawBytes += raw;
        taken++;
      }

      const prepare = async (
        item: (typeof group)[number],
      ): Promise<Prepared> => {
        const recording = item.recording!;
        const file = await ctx.storage.get(recording.file);
        if (!file || file.size > MAX_RECORDING_BYTES)
          throw new Error('Recording file unavailable or too large');
        const streams = decodeWhole(
          new Uint8Array(await file.arrayBuffer()),
          recording.manifest,
        );
        const tooLarge = (streams.latlng?.data.length ?? 0) > policy.maxSamples;
        // The Postgres worker projects an absent GPS channel as JSON null,
        // and the matcher's answer depends on it.
        const payload = streams.latlng ? streams : { ...streams, latlng: null };
        return {
          key: item.key,
          id: item.id!,
          recording,
          tooLarge,
          track: tooLarge
            ? undefined
            : prepareTrack(
                payload as Parameters<typeof prepareTrack>[0],
                policy,
              ),
        };
      };
      const match = async (prepared: Prepared[]) => {
        const windows: PlaceQueryWindow[] = [];
        for (const { track } of prepared)
          if (track)
            windows.push(
              ...placeQueryWindows(track.geometry, policy.discoveryRadiusM),
            );
        const scoped = uniqueQueryWindows(windows);
        const read = await readMatchingTiles(
          scoped,
          (tile, cursor) =>
            ctx.runQuery(internal.places.tilePage, {
              dataset: batch.catalogue.dataset,
              tile,
              paginationOpts: { numItems: 256, cursor },
            }),
          1,
        );
        const matcher = createBatchActivityPlaceMatcher({
          snapshot: {
            catalogue,
            revision: batch.catalogue.revision,
            places: read.places as CandidatePlace[],
            windows: scoped,
          },
          policy,
        });
        const results = [];
        for (const item of prepared)
          results.push({
            key: item.key,
            recording: item.recording.id,
            result: activityPlacesResponseSchema.parse(
              await matcher.match(
                {
                  userId: batch.userId,
                  activityId: item.id,
                  input: {
                    payload: null,
                    generation: item.recording.generation,
                    revision: item.recording.revision,
                    too_large: item.tooLarge,
                  },
                },
                item.track,
              ),
            ),
          });
        return results;
      };

      let results: Awaited<ReturnType<typeof match>> = [];
      const failed: { key: string; reason: string }[] = [];
      let handled = taken;
      if (group.length > 0) {
        try {
          results = await match(await Promise.all(group.map(prepare)));
        } catch (error) {
          // Retry the first activity alone; the rest stay for the next step.
          const first = group[0]!;
          handled = batch.items.findIndex((item) => item.key === first.key) + 1;
          skipped = batch.items
            .slice(0, handled)
            .filter((item) => !item.recording || item.id === null).length;
          try {
            if (group.length === 1) throw error;
            results = await match([await prepare(first)]);
          } catch (single) {
            failed.push({
              key: first.key,
              reason: String(
                single instanceof Error ? single.message : single,
              ).slice(0, 200),
            });
          }
        }
      }
      const last = batch.items[handled - 1];
      if (!last) {
        // Nothing left to read.
        await ctx.runMutation(internal.shadowMatching.commit, {
          ...args,
          after: '￿',
          done: true,
          skipped: 0,
          results: [],
          failed: [],
        });
        return;
      }
      await ctx.runMutation(internal.shadowMatching.commit, {
        ...args,
        after: last.key,
        done: batch.exhausted && handled === batch.items.length,
        skipped,
        results,
        failed,
      });
    } catch (error) {
      await ctx.runMutation(internal.shadowMatching.fail, {
        ...args,
        reason: String(error instanceof Error ? error.message : error),
      });
    }
  },
});
