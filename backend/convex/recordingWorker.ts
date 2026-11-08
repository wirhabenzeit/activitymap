'use node';

import { v } from 'convex/values';

import type { StreamMetadata } from '../../src/contracts/v1/activity-streams';
import { MAX_RECORDING_BYTES, decodeWhole, sha256 } from '../recording/codec';
import { recordingSummary } from '../recording/summary';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { scopeFields } from './ownerScope';
import { manifestValidator } from './recordingValidators';

/** The trusted worker passes a staged immutable file and its manifest. Raw
 * recording arrays stay within the Node action. Commit rechecks every fence. */
export const prepare = internalAction({
  args: {
    scope: v.object(scopeFields),
    id: v.string(),
    generation: v.string(),
    sourceRevision: v.number(),
    recordingGeneration: v.string(),
    recordingRevision: v.string(),
    file: v.id('_storage'),
    manifest: manifestValidator,
  },
  handler: async (
    ctx,
    { recordingGeneration, recordingRevision, ...args },
  ): Promise<boolean> => {
    // Schedule before decoding/publication: survives action exceptions and
    // worker interruption. Successful publications are protected by references.
    await ctx.scheduler.runAfter(
      60 * 60 * 1000,
      internal.maintenance.cleanupRecording,
      { file: args.file },
    );
    try {
      const file = await ctx.storage.get(args.file);
      if (!file || file.size > MAX_RECORDING_BYTES)
        throw new Error('Recording file unavailable or too large');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const streams = decodeWhole(bytes, args.manifest);
      const published = await ctx.runMutation(
        internal.activityWrites.publishRecording,
        {
          ...args,
          compressedHash: sha256(bytes, 'base64'),
          metadata: {
            generation: recordingGeneration,
            revision: recordingRevision,
            state: 'current',
            fetch_status: 'succeeded',
            available_types: Object.keys(
              args.manifest.counts,
            ) as StreamMetadata['available_types'],
            fetched_at: new Date().toISOString(),
            expires_at: null,
          },
          summary: recordingSummary(streams),
        },
      );
      if (!published)
        await ctx.runMutation(internal.maintenance.cleanupRecording, {
          file: args.file,
        });
      return published;
    } catch (error) {
      await ctx.runMutation(internal.maintenance.cleanupRecording, {
        file: args.file,
      });
      throw error;
    }
  },
});
