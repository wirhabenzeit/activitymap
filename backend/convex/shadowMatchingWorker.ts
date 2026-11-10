'use node';

import { v } from 'convex/values';

import {
  type PreparedActivity,
  isMatchingVersion,
  matchPrepared,
  prepareActivity,
  readCatalogue,
} from '../matching/activity-match';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';

/**
 * The shadow matcher's worker. The matching itself is
 * `backend/matching/activity-match.ts`, which the ingestion worker uses too.
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

export const run = internalAction({
  args: { run: v.id('shadowMatchRuns') },
  handler: async (ctx, args): Promise<void> => {
    try {
      const batch = await ctx.runQuery(internal.shadowMatching.load, args);
      if (!batch) return;
      // Results are comparable only if this rowset and recipe are the ones
      // the owner's copied results were computed with.
      if (!isMatchingVersion(batch.catalogue, batch.matchingVersion))
        throw new Error(
          'The catalogue rowset or matching recipe differs from the owner’s',
        );
      const published = await readCatalogue(ctx, batch.catalogue);

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

      const prepare = (item: (typeof group)[number]) =>
        prepareActivity(ctx, {
          key: item.key,
          id: item.id!,
          recording: item.recording!,
        });
      const match = (prepared: PreparedActivity[]) =>
        matchPrepared(
          ctx,
          { userId: batch.userId, catalogue: batch.catalogue, published },
          prepared,
        );

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
