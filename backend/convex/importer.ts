import { v } from 'convex/values';

import { internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  activityMetadataValidator,
  photoValidator,
  placeMatchValidator,
} from './activityValidators';
import {
  activityFor,
  applySourceRecord,
  publishMatchRecord,
} from './activityWrites';
import { scopeFields } from './ownerScope';
import { idKey, ownerFor, requireHead, requireOwner } from './owners';
import { applyPhotoSet, deletePhotoRecords } from './photos';
import { manifestValidator } from './recordingValidators';

/**
 * Trusted batch writers for copying Postgres state into this package: the
 * operator-run importer and the shadow-write mirror. Every write goes through
 * the same fenced code paths as live ingestion (applySource, recording
 * preparation and match publication), so stale or repeated batches are no-ops.
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

/** What a mirror run needs to continue: fences and its last position. */
export const mirrorState = internalQuery({
  args: { userId: v.string(), athleteId: v.string() },
  handler: async (ctx, { userId, athleteId }) => {
    const owner = await ownerFor(ctx, userId);
    if (!owner || owner.athleteId !== athleteId) return null;
    const head = await requireHead(ctx, owner._id);
    return {
      backend: owner.backend,
      epoch: owner.epoch,
      generation: owner.generation,
      revoked: owner.revoked,
      catalogue: owner.catalogue,
      matchingVersion: owner.matchingVersion,
      mirror: head.mirror ?? null,
    };
  },
});

/** Positions only move forward, so a delayed run cannot rewind a newer one. */
export const checkpoint = internalMutation({
  args: {
    scope,
    sequence: v.number(),
    revision: v.number(),
    /** Full-copy progress; null marks the copy finished. */
    full: v.optional(
      v.union(v.null(), v.object({ after: v.string(), through: v.number() })),
    ),
    /** Photo catch-up progress; null marks it finished. */
    photos: v.optional(v.union(v.null(), v.string())),
  },
  handler: async (ctx, { scope, sequence, revision, full, photos }) => {
    const owner = await requireOwner(ctx, scope);
    const head = await requireHead(ctx, owner._id);
    if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(revision))
      throw new Error('Invalid mirror position');
    const progress = full === undefined ? head.mirror?.full : full;
    // Finished stays finished: a delayed run cannot reopen the catch-up.
    const caughtUp =
      head.mirror?.photos === null || photos === undefined
        ? head.mirror?.photos
        : photos;
    await ctx.db.patch('ownerHeads', head._id, {
      mirror: {
        sequence: Math.max(head.mirror?.sequence ?? 0, sequence),
        revision: Math.max(head.mirror?.revision ?? 0, revision),
        ...(progress && { full: progress }),
        ...(caughtUp !== undefined && { photos: caughtUp }),
      },
    });
  },
});

export const deleteSources = internalMutation({
  args: {
    scope,
    generation: v.string(),
    sourceRevision: v.number(),
    ids: v.array(v.string()),
  },
  handler: async (ctx, { ids, ...common }) => {
    bounded(ids.length);
    let deleted = 0;
    for (const id of ids)
      if (await applySourceRecord(ctx, { ...common, id, dto: null })) deleted++;
    return deleted;
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

/** The current photo sets of up to 64 activities. An activity listed with no
 * photos loses the ones stored for it. Returns how many photos changed. */
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
    bounded(items.length);
    let changed = 0;
    for (const item of items)
      changed += await applyPhotoSet(ctx, { ...common, ...item });
    return changed;
  },
});

/** Photos that no longer exist at the source and whose activity the writer
 * no longer knows. */
export const deletePhotos = internalMutation({
  args: { scope, generation: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    bounded(args.ids.length);
    return deletePhotoRecords(ctx, args);
  },
});
