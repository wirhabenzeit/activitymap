import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import { type QueryCtx, query } from './_generated/server';
import {
  MAX_ACTIVITIES_PER_READ,
  PROJECTION_VERSION,
  READ_BUDGET_BYTES,
} from './activityProjection';
import { activityFor } from './activityWrites';
import { project } from './liveProjection';
import { idKey, requireHead } from './owners';
import { summariesFor } from './sync';
import { requireViewer, viewer } from './viewer';

/**
 * Public library queries for authenticated clients (docs/convex-reactive-
 * reads.md). Every function derives the owner from the caller's token and
 * takes no user argument. Only `changes` reads `ownerHeads`, which changes on
 * every write: the others would re-run on every write anywhere in the library.
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

type Card = Omit<NonNullable<ReturnType<typeof project>>, 'map_polyline'>;

function card(row: Doc<'activities'>, owner: Doc<'owners'>): Card | null {
  const item = project(row, owner);
  if (!item) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { map_polyline, ...rest } = item;
  return rest;
}

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
        const item = card(row, owner);
        return item ? [item] : [];
      }),
    };
  },
});

/** Everything that, when it changes, changes every card: a client holding
 * cards for another version must load the library again. */
function libraryVersion(owner: Doc<'owners'>) {
  return [
    owner.epoch,
    owner.generation,
    owner.matchingVersion,
    owner.projectionVersion,
    PROJECTION_VERSION,
  ].join(':');
}

const MAX_CHANGES_PER_READ = 256;

/**
 * The library's changes after `after` (a sequence this query returned
 * earlier), collapsed per activity: the current card for each changed
 * activity and the IDs of deleted ones. One read covers up to 256 change
 * entries and at most 32 distinct activities, whose documents it reads.
 * `sequence` is the position to continue from; `more` means another read
 * is ready at once.
 *
 * `after: null`, a sequence below the retention floor or one this owner never
 * reached returns `reload` with the head sequence: the client loads the
 * library through `list` and continues from there. Clients also reload when
 * `version` differs from the one their cards were loaded under.
 */
export const changes = query({
  args: { after: v.union(v.number(), v.null()) },
  handler: async (ctx, { after }) => {
    const owner = await requireViewer(ctx);
    const head = await requireHead(ctx, owner._id);
    const version = libraryVersion(owner);
    if (
      after === null ||
      !Number.isSafeInteger(after) ||
      after < head.retentionFloor ||
      after > head.sequence
    )
      return {
        reload: true as const,
        sequence: head.sequence,
        version,
        matchingVersion: owner.matchingVersion,
      };
    const read = await ctx.db
      .query('changes')
      .withIndex('by_owner_sequence', (q) =>
        q.eq('owner', owner._id).gt('sequence', after),
      )
      .take(MAX_CHANGES_PER_READ);
    // Stop before the change that would add a 33rd activity to read.
    const touchedIds = new Set<string>();
    const rows: typeof read = [];
    for (const row of read) {
      // Photo changes move the position only: live clients read the photo
      // list separately (src/lib/sync/live-photos.ts).
      if (row.entityType === 'photo') {
        rows.push(row);
        continue;
      }
      if (
        !touchedIds.has(row.entityId) &&
        touchedIds.size === MAX_ACTIVITIES_PER_READ
      )
        break;
      touchedIds.add(row.entityId);
      rows.push(row);
    }
    const touched = [...touchedIds];
    const current = await Promise.all(
      touched.map(async (id) => {
        const row = await activityFor(ctx, owner._id, idKey(id));
        return { id, card: row && card(row, owner) };
      }),
    );
    return {
      reload: false as const,
      sequence: rows.at(-1)?.sequence ?? after,
      more: rows.length < read.length || read.length === MAX_CHANGES_PER_READ,
      version,
      matchingVersion: owner.matchingVersion,
      upserts: current.flatMap(({ card }) => (card ? [card] : [])),
      deletes: current.flatMap(({ id, card }) => (card ? [] : [id])),
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
