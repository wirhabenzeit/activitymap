import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
} from './_generated/server';
import { PROJECTION_VERSION, READ_BUDGET_BYTES } from './activityProjection';

/**
 * Per-owner counts of place matches for the operator dashboard
 * (convex/admin.ts), kept current in the transaction of each change. Apart
 * from `ownerStats`, which clients subscribe to: a re-match of a library
 * would update their status with every activity.
 */

/** Whether the activity is in the library with a match clients see. */
export function isMatched(
  owner: Doc<'owners'>,
  row: Doc<'activities'> | null,
): boolean {
  return (
    !!row?.dto &&
    !row.deleted &&
    row.generation === owner.generation &&
    row.projection?.version === PROJECTION_VERSION &&
    row.projection.generation === owner.generation &&
    row.projection.match?.catalogue === owner.catalogue
  );
}

function countsFor(ctx: QueryCtx, owner: Id<'owners'>) {
  return ctx.db
    .query('placeMatchCounts')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .unique();
}

/**
 * Apply one activity's change. `rematched` is the live catalogue revision of
 * a match that replaced one of an older revision. While a recount runs, rows
 * it has not reached yet are skipped: it counts them when it does.
 */
export async function applyMatchCount(
  ctx: MutationCtx,
  owner: Id<'owners'>,
  key: string,
  before: boolean,
  after: boolean,
  rematched?: number,
) {
  if (before === after && rematched === undefined) return;
  const row = await countsFor(ctx, owner);
  if (!row) return;
  const reached = row.rebuildAfter === undefined || key <= row.rebuildAfter;
  const matched = row.matched + (reached ? Number(after) - Number(before) : 0);
  // A late match of an earlier revision is not part of the current re-match.
  const counted =
    rematched === undefined || rematched < row.revision
      ? {}
      : {
          revision: rematched,
          rematched: rematched === row.revision ? row.rematched + 1 : 1,
        };
  await ctx.db.patch('placeMatchCounts', row._id, { matched, ...counted });
}

/** A new owner has no matches yet. */
export async function startMatchCounts(ctx: MutationCtx, owner: Id<'owners'>) {
  await ctx.db.insert('placeMatchCounts', {
    owner,
    matched: 0,
    rematched: 0,
    revision: 0,
  });
}

/** Count an owner's matches again, in bounded steps: after its catalogue
 * changed, and for owners from before the counts. */
export async function recountMatches(ctx: MutationCtx, owner: Id<'owners'>) {
  const row = await countsFor(ctx, owner);
  const fresh = { matched: 0, rebuildAfter: '' };
  if (row) await ctx.db.patch('placeMatchCounts', row._id, fresh);
  else
    await ctx.db.insert('placeMatchCounts', {
      owner,
      rematched: 0,
      revision: 0,
      ...fresh,
    });
  await ctx.scheduler.runAfter(0, internal.placeCounts.rebuildStep, { owner });
}

const OWNER_PAGE = 32;

/** Count every library's matches again (`convex run placeCounts:rebuild`).
 * Writes keep the counts consistent meanwhile. */
export const rebuild = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('owners')
      .paginate({ numItems: OWNER_PAGE, cursor: cursor ?? null });
    for (const owner of page.page)
      if (!owner.revoked) await recountMatches(ctx, owner._id);
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.placeCounts.rebuild, {
        cursor: page.continueCursor,
      });
  },
});

const REBUILD_PAGE = 64;

export const rebuildStep = internalMutation({
  args: { owner: v.id('owners') },
  handler: async (ctx, { owner: ownerId }) => {
    const [owner, counts] = await Promise.all([
      ctx.db.get('owners', ownerId),
      countsFor(ctx, ownerId),
    ]);
    if (!owner || counts?.rebuildAfter === undefined) return;
    const { page: rows, isDone: done } = await ctx.db
      .query('activities')
      .withIndex('by_owner_live_key', (q) =>
        q
          .eq('owner', owner._id)
          .eq('generation', owner.generation)
          .eq('deleted', false)
          .gt('key', counts.rebuildAfter!),
      )
      .paginate({
        numItems: REBUILD_PAGE,
        cursor: null,
        maximumBytesRead: READ_BUDGET_BYTES,
      });
    const last = rows.at(-1);
    if (!done && !last) throw new Error('Match recount made no progress');
    await ctx.db.patch('placeMatchCounts', counts._id, {
      matched:
        counts.matched + rows.filter((row) => isMatched(owner, row)).length,
      rebuildAfter: done ? undefined : last!.key,
    });
    if (!done)
      await ctx.scheduler.runAfter(0, internal.placeCounts.rebuildStep, {
        owner: ownerId,
      });
  },
});
