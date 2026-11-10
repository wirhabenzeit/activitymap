'use node';

import { type ObjectType, v } from 'convex/values';

import { ACTIVITY_STREAM_TYPES } from '../../src/server/strava/streams';
import { MAX_RECORDING_BYTES, decodeWhole, sha256 } from '../recording/codec';
import { recordingSummary } from '../recording/summary';
import { internal } from './_generated/api';
import { type ActionCtx, internalAction } from './_generated/server';
import { scopeFields, writerValidator } from './ownerScope';
import { manifestValidator } from './recordingValidators';

const prepareArgs = {
  scope: v.object(scopeFields),
  id: v.string(),
  generation: v.string(),
  sourceRevision: v.number(),
  /** Who is writing; Postgres when absent. */
  writer: v.optional(writerValidator),
  recordingGeneration: v.string(),
  recordingRevision: v.string(),
  file: v.id('_storage'),
  manifest: manifestValidator,
  /** When the samples were fetched from the provider (imports keep it). */
  fetchedAt: v.optional(v.string()),
};

/** Publish a staged immutable file as an activity's recording. Raw recording
 * arrays stay within the Node action. Commit rechecks every fence, and a
 * file that is not accepted is removed. */
export async function prepareRecording(
  ctx: ActionCtx,
  {
    recordingGeneration,
    recordingRevision,
    fetchedAt,
    ...args
  }: ObjectType<typeof prepareArgs>,
): Promise<boolean> {
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
          // Convex stores object fields sorted by name; keep the canonical
          // stream order that Postgres and the clients use.
          available_types: ACTIVITY_STREAM_TYPES.filter(
            (type) => args.manifest.counts[type] !== undefined,
          ),
          fetched_at: fetchedAt ?? new Date().toISOString(),
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
}

/** The trusted worker passes a staged immutable file and its manifest. */
export const prepare = internalAction({
  args: prepareArgs,
  handler: prepareRecording,
});
