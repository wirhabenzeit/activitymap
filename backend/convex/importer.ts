import { v } from 'convex/values';

import { internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  activityMetadataValidator,
  placeMatchValidator,
} from './activityValidators';
import {
  activityFor,
  applySourceRecord,
  publishMatchRecord,
} from './activityWrites';
import { scopeFields } from './ownerScope';
import { idKey, ownerFor, requireOwner } from './owners';
import { manifestValidator } from './recordingValidators';

/**
 * Trusted, operator-run import of an existing Postgres library. Every write
 * goes through the same fenced code paths as live ingestion (applySource,
 * recording preparation and match publication), so an import exercises the
 * production invariants rather than side-loading rows.
 */

const scope = v.object(scopeFields);
const BATCH_LIMIT = 64;

function bounded(length: number) {
  if (length < 1 || length > BATCH_LIMIT)
    throw new Error(`Import batches hold 1-${BATCH_LIMIT} items`);
}

/** Operator view of an existing assignment, so a re-run reuses its fences. */
export const owner = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const owner = await ownerFor(ctx, userId);
    return (
      owner && {
        athleteId: owner.athleteId,
        backend: owner.backend,
        epoch: owner.epoch,
        generation: owner.generation,
        revoked: owner.revoked,
        catalogue: owner.catalogue,
        matchingVersion: owner.matchingVersion,
      }
    );
  },
});

export const applySources = internalMutation({
  args: {
    scope,
    generation: v.string(),
    sourceRevision: v.number(),
    items: v.array(activityMetadataValidator),
    /** The source's current stored recordings, by activity. */
    recordings: v.array(
      v.object({
        id: v.string(),
        generation: v.string(),
        revision: v.string(),
      }),
    ),
  },
  handler: async (
    ctx,
    { scope, generation, sourceRevision, items, recordings },
  ) => {
    bounded(items.length);
    let applied = 0;
    for (const dto of items) {
      if (
        await applySourceRecord(ctx, {
          scope,
          id: dto.id,
          generation,
          sourceRevision,
          dto,
        })
      )
        applied++;
    }
    // Report what is still missing so re-runs only upload and match the rest.
    const owner = await requireOwner(ctx, scope);
    const needsRecording: string[] = [];
    const needsMatch: string[] = [];
    const sourceRecordings = new Map(recordings.map((item) => [item.id, item]));
    for (const dto of items) {
      const row = await activityFor(ctx, owner._id, idKey(dto.id));
      if (!row || row.deleted) continue;
      const source = sourceRecordings.get(dto.id);
      const current =
        row.recording && (await ctx.db.get('recordings', row.recording));
      // A different identity means the source refreshed its samples; the
      // newer revision replaces the copy (and its match) on publication.
      const outdated =
        source &&
        (current?.generation !== source.generation ||
          current.revision !== source.revision);
      if (outdated) needsRecording.push(dto.id);
      if (outdated || row.projection?.match?.catalogue !== owner.catalogue)
        needsMatch.push(dto.id);
    }
    return { applied, needsRecording, needsMatch };
  },
});

export const uploadUrls = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    bounded(count);
    return Promise.all(
      Array.from({ length: count }, () => ctx.storage.generateUploadUrl()),
    );
  },
});

export const prepareRecordings = internalAction({
  args: {
    scope,
    generation: v.string(),
    sourceRevision: v.number(),
    items: v.array(
      v.object({
        id: v.string(),
        file: v.id('_storage'),
        manifest: manifestValidator,
        recordingGeneration: v.string(),
        recordingRevision: v.string(),
        fetchedAt: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { items, ...common }): Promise<number> => {
    bounded(items.length);
    let published = 0;
    // Sequential: each publication bumps the owner's feed head.
    for (const item of items) {
      if (
        await ctx.runAction(internal.recordingWorker.prepare, {
          ...common,
          ...item,
        })
      )
        published++;
    }
    return published;
  },
});

export const publishMatches = internalMutation({
  args: {
    scope,
    generation: v.string(),
    sourceRevision: v.number(),
    catalogue: v.string(),
    items: v.array(placeMatchValidator),
  },
  handler: async (ctx, { items, ...common }) => {
    bounded(items.length);
    const owner = await requireOwner(ctx, common.scope);
    let published = 0;
    for (const result of items) {
      const row = await activityFor(ctx, owner._id, idKey(result.activityId));
      if (!row?.recording) continue;
      if (
        await publishMatchRecord(ctx, {
          ...common,
          id: result.activityId,
          recording: row.recording,
          result,
        })
      )
        published++;
    }
    return published;
  },
});
