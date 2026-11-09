import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import { type QueryCtx, query } from './_generated/server';
import {
  MAX_ACTIVITIES_PER_READ,
  READ_BUDGET_BYTES,
} from './activityProjection';
import { activityFor } from './activityWrites';
import { project } from './liveProjection';
import { idKey } from './owners';
import { summariesFor } from './sync';
import { requireViewer, viewer } from './viewer';

/**
 * Public library queries for authenticated clients (docs/convex-reactive-
 * reads.md). Every function derives the owner from the caller's token and
 * takes no user argument. None reads `ownerHeads`, which changes on every
 * write and would re-run every subscription.
 */

/** Who the caller is to this backend: signed in, and served from Convex. */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const owner = await viewer(ctx);
    return {
      signedIn: identity !== null,
      userId: identity?.subject ?? null,
      athleteId: owner?.athleteId ?? null,
      served: owner !== null,
    };
  },
});

/** Cards are the v1 activity DTO without `map_polyline`: the map draws from
 * the summary polyline, and detailed polylines are most of the library's
 * bytes. `library.activity` returns them on demand. A page holds up to 256
 * cards, and fewer when its documents reach the read budget: continue from
 * `continueCursor` until `isDone`. */
const MAX_CARDS_PER_PAGE = 256;

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const owner = await requireViewer(ctx);
    const result = await ctx.db
      .query('activities')
      .withIndex('by_owner_live_key', (q) =>
        q
          .eq('owner', owner._id)
          .eq('generation', owner.generation)
          .eq('deleted', false),
      )
      .paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, MAX_CARDS_PER_PAGE),
        maximumBytesRead: Math.min(
          paginationOpts.maximumBytesRead ?? READ_BUDGET_BYTES,
          READ_BUDGET_BYTES,
        ),
      });
    return {
      ...result,
      page: result.page.flatMap((row) => {
        const item = project(row, owner);
        if (!item) return [];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { map_polyline, ...card } = item;
        return [card];
      }),
    };
  },
});

/** The full v1 DTO, including the detailed polyline, or null. */
export const activity = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const owner = await requireViewer(ctx);
    const row = await activityFor(ctx, owner._id, idKey(id));
    return (row && project(row, owner)) ?? null;
  },
});

/** Chart summaries and stream metadata for up to 32 activities. */
export const summaries = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    if (ids.length > MAX_ACTIVITIES_PER_READ)
      throw new Error('Too many summary IDs');
    return summariesFor(ctx, await requireViewer(ctx), ids);
  },
});

function boundary(ctx: QueryCtx, owner: Doc<'owners'>, order: 'asc' | 'desc') {
  return ctx.db
    .query('activities')
    .withIndex('by_owner_live_start', (q) =>
      q
        .eq('owner', owner._id)
        .eq('generation', owner.generation)
        .eq('deleted', false),
    )
    .order(order)
    .first();
}

/** Library counts for the status view. `ready` is false while the counts are
 * being rebuilt (or have never been built for this owner). */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const owner = await requireViewer(ctx);
    const [stats, oldest, newest] = await Promise.all([
      ctx.db
        .query('ownerStats')
        .withIndex('by_owner', (q) => q.eq('owner', owner._id))
        .unique(),
      boundary(ctx, owner, 'asc'),
      boundary(ctx, owner, 'desc'),
    ]);
    if (!stats || stats.rebuildAfter !== undefined)
      return { ready: false as const };
    return {
      ready: true as const,
      counts: stats.counts,
      oldest: oldest?.dto?.start_date ?? null,
      newest: newest?.dto?.start_date ?? null,
    };
  },
});
