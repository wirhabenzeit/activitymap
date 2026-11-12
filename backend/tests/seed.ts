import { v } from 'convex/values';

import { internalAction, internalMutation } from '../convex/_generated/server';
import {
  activityMetadataValidator,
  photoValidator,
  placeMatchValidator,
} from '../convex/activityValidators';
import {
  activityFor,
  applySourceArgs,
  applySourceRecord,
  publishMatchArgs,
  publishMatchRecord,
} from '../convex/activityWrites';
import { selectFor } from '../convex/catalogue';
import { scopeFields } from '../convex/ownerScope';
import { idKey, requireOwner, requireWritableOwner } from '../convex/owners';
import { applyPhotoSet, deletePhotoRecords } from '../convex/photos';
import { manifestValidator } from '../convex/recordingValidators';
import { prepareArgs, prepareRecording } from '../convex/recordingWorker';

/**
 * Test-only Convex functions that put a library into a given state through
 * the same fenced writes live ingestion uses. They are registered as the
 * module `seed` in the tests' module maps (see `./seed-api.ts`) and are never
 * deployed.
 */

const scope = v.object(scopeFields);

export const applySource = internalMutation({
  args: applySourceArgs,
  handler: applySourceRecord,
});

export const publishMatch = internalMutation({
  args: publishMatchArgs,
  handler: publishMatchRecord,
});

export const prepare = internalAction({
  args: prepareArgs,
  handler: prepareRecording,
});

export const selectCatalogue = internalMutation({
  args: {
    scope,
    catalogue: v.string(),
    matchingVersion: v.string(),
  },
  handler: async (ctx, { scope, ...args }) =>
    selectFor(ctx, await requireWritableOwner(ctx, scope), args),
});

export const deleteSources = internalMutation({
  args: {
    scope,
    generation: v.string(),
    sourceRevision: v.number(),
    ids: v.array(v.string()),
  },
  handler: async (ctx, { ids, ...common }) => {
    let deleted = 0;
    for (const id of ids)
      if (await applySourceRecord(ctx, { ...common, id, dto: null })) deleted++;
    return deleted;
  },
});

/** Apply several activities; reports which still need a recording or a
 * match under the owner's catalogue. */
export const applySources = internalMutation({
  args: {
    scope,
    generation: v.string(),
    sourceRevision: v.number(),
    items: v.array(activityMetadataValidator),
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
    let applied = 0;
    for (const dto of items)
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
    let published = 0;
    for (const item of items)
      if (await prepareRecording(ctx, { ...common, ...item })) published++;
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

export const applyPhotoSets = internalMutation({
  args: {
    scope,
    generation: v.string(),
    sourceRevision: v.number(),
    items: v.array(
      v.object({ activityId: v.string(), photos: v.array(photoValidator) }),
    ),
  },
  handler: async (ctx, { items, ...common }) => {
    let changed = 0;
    for (const item of items)
      changed += await applyPhotoSet(ctx, { ...common, ...item });
    return changed;
  },
});

export const deletePhotos = internalMutation({
  args: {
    scope,
    generation: v.string(),
    sourceRevision: v.number(),
    ids: v.array(v.string()),
  },
  handler: async (ctx, args) => deletePhotoRecords(ctx, args),
});
