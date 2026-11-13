import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
} from './_generated/server';
import { READ_BUDGET_BYTES } from './activityProjection';
import { currentRecording, project } from './liveProjection';
import { ownerFor } from './owners';
import { storedPhotoCount } from './photos';
import { COUNT_FIELDS, type Counts, zeroCounts } from './statsShape';

/**
 * Per-owner library counts for the live status view, kept current by the
 * write paths in the same transaction as each change, so a status
 * subscription reads one document instead of scanning the library.
 */

/** What one activity row adds to its owner's counts (null: not in the
 * current library), its stored photos included. Mirrors the bridge's paged
 * status operation. */
export async function contribution(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  row: Doc<'activities'> | null,
): Promise<Counts | null> {
  const item = row && project(row, owner);
  if (!row || !item) return null;
  const counts = zeroCounts();
  counts.total = 1;
  if (item.geometry_state === 'detailed') counts.detailed = 1;
  else if (item.geometry_state === 'refresh_required')
    counts.invalidatedDetails = 1;
  else counts.neverFetched = 1;
  if ((item.total_photo_count ?? item.photo_count ?? 0) > 0) {
    counts.activitiesWithPhotos = 1;
    if (item.photos_state === 'current') counts.currentPhotos = 1;
    else if (item.photos_state === 'refresh_required')
      counts.refreshRequiredPhotos = 1;
    else counts.unknownPhotos = 1;
  }
  // Every stored photo counts; an activity counts as stored only while the
  // provider reports photos for it, matching the application status contract.
  counts.photoCount = await storedPhotoCount(ctx, owner, row.key);
  if (counts.activitiesWithPhotos && counts.photoCount > 0)
    counts.activitiesWithStoredPhotos = 1;
  const recording = await currentRecording(ctx, row, item);
  if (recording) {
    if (Object.values(recording.manifest.counts).some((count) => count! > 0))
      counts.withData = 1;
    else counts.withoutData = 1;
    if (recording.summary) counts.chartSummaries = 1;
  } else {
    counts.runnable = 1;
    if (item.streams?.state === 'stale') counts.invalidatedStreams = 1;
  }
  return counts;
}

function statsFor(ctx: QueryCtx, owner: Id<'owners'>) {
  return ctx.db
    .query('ownerStats')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .unique();
}

/** Apply one row's change. While a rebuild runs, rows it has not reached yet
 * are skipped: the rebuild counts them in their state at that time. */
export async function applyStats(
  ctx: MutationCtx,
  owner: Id<'owners'>,
  key: string,
  before: Counts | null,
  after: Counts | null,
) {
  const delta = COUNT_FIELDS.map(
    (field) => (after?.[field] ?? 0) - (before?.[field] ?? 0),
  );
  if (delta.every((value) => value === 0)) return;
  const stats = await statsFor(ctx, owner);
  if (!stats) return;
  if (stats.rebuildAfter !== undefined && key > stats.rebuildAfter) return;
  const counts = { ...stats.counts };
  COUNT_FIELDS.forEach((field, index) => (counts[field] += delta[index]!));
  await ctx.db.patch('ownerStats', stats._id, { counts });
}

const REBUILD_PAGE = 64;

/** Recount an owner's library in bounded batches (existing owners, or after
 * a change to what is counted). Writes keep counts consistent meanwhile. */
export const rebuild = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const owner = await ownerFor(ctx, userId);
    if (!owner) throw new Error('Owner unavailable');
    const stats = await statsFor(ctx, owner._id);
    const fresh = { counts: zeroCounts(), rebuildAfter: '' };
    if (stats) await ctx.db.patch('ownerStats', stats._id, fresh);
    else await ctx.db.insert('ownerStats', { owner: owner._id, ...fresh });
    await ctx.scheduler.runAfter(0, internal.stats.rebuildStep, {
      owner: owner._id,
    });
  },
});

export const rebuildStep = internalMutation({
  args: { owner: v.id('owners') },
  handler: async (ctx, { owner: ownerId }) => {
    const [owner, stats] = await Promise.all([
      ctx.db.get('owners', ownerId),
      statsFor(ctx, ownerId),
    ]);
    if (!owner || stats?.rebuildAfter === undefined) return;
    // Activities stop at the read budget; their recordings (one per
    // activity, a few KiB each) stay well within the rest of the limit.
    const { page: rows, isDone: done } = await ctx.db
      .query('activities')
      .withIndex('by_owner_live_key', (q) =>
        q
          .eq('owner', owner._id)
          .eq('generation', owner.generation)
          .eq('deleted', false)
          .gt('key', stats.rebuildAfter!),
      )
      .paginate({
        numItems: REBUILD_PAGE,
        cursor: null,
        maximumBytesRead: READ_BUDGET_BYTES,
      });
    const counts = { ...stats.counts };
    for (const row of rows) {
      const add = await contribution(ctx, owner, row);
      if (add) for (const field of COUNT_FIELDS) counts[field] += add[field];
    }
    const last = rows.at(-1);
    if (!done && !last) throw new Error('Stats rebuild made no progress');
    await ctx.db.patch('ownerStats', stats._id, {
      counts,
      rebuildAfter: done ? undefined : last!.key,
    });
    if (!done)
      await ctx.scheduler.runAfter(0, internal.stats.rebuildStep, {
        owner: ownerId,
      });
  },
});
