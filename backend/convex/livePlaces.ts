import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import {
  EMPTY_SET_DIGEST,
  PLACE_BATCH_LIMIT,
  addToSetDigest,
  removeFromSetDigest,
  rowHash,
  tileOf,
} from '../../src/server/places/catalogue-rows';
import { internal } from './_generated/api';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { placeValidator as place } from './placeValidators';

/**
 * The live place catalogue: one row per place, which a publication updates
 * in place (src/server/places/catalogue-publish.ts). The publisher reads the
 * live row hashes, diffs them with its artifact and sends only the
 * difference:
 *
 * - `beginApply` announces the artifact and the row count and set digest the
 *   rows must reach;
 * - `applyBatch` upserts and deletes rows. A write that changes nothing is
 *   skipped, so a repeated batch is harmless. Every write keeps `count` and
 *   `setDigest` current and records the tiles it touched in
 *   `placeTileChanges`;
 * - `completeApply` accepts the publication when the rows have reached what
 *   was announced, and schedules the re-match walk over the changed tiles.
 *
 * An interrupted publication resumes: the next diff holds only what is still
 * missing. Expected refusals are returned, not thrown, so the publisher can
 * tell the operator why.
 */

const SNAPSHOT_ID_LIMIT = 256;
/** About 120 bytes a row in the answer. A page of full `livePlaces`
 * documents (well under 2 KiB each) stays far below a query's 32,000
 * documents and 16 MiB read. */
const HASH_PAGE_LIMIT = 4096;
const TILE_BATCH_LIMIT = 500;
/** `activityPlaceTiles` rows hold an owner ID, an activity key and a tile,
 * well under 256 bytes: a page reads about 2 MiB at most, far below a
 * query's 32,000 documents and 16 MiB read, and answers fewer entries. */
const DEMAND_PAGE_LIMIT = 8192;

function stateRow(ctx: QueryCtx) {
  return ctx.db.query('placeCatalogueState').unique();
}

export function publicationFor(ctx: QueryCtx, revision: number) {
  return ctx.db
    .query('placePublications')
    .withIndex('by_revision', (q) => q.eq('revision', revision))
    .unique();
}

function liveRow(ctx: QueryCtx, key: string) {
  return ctx.db
    .query('livePlaces')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
}

function checkIdentity(args: {
  snapshotId: string;
  count: number;
  setDigest: string;
  source?: { dataAsOf: number; regions: number };
}) {
  if (
    !args.snapshotId ||
    args.snapshotId.length > SNAPSHOT_ID_LIMIT ||
    !Number.isSafeInteger(args.count) ||
    args.count < 0 ||
    !/^[0-9a-f]{64}$/.test(args.setDigest) ||
    (args.source &&
      !(
        Number.isSafeInteger(args.source.dataAsOf) &&
        Number.isSafeInteger(args.source.regions) &&
        args.source.regions >= 0
      ))
  )
    throw new Error('Invalid live catalogue identity');
}

/** The live catalogue's state, or null before anything was applied.
 * `metadataUrl` is the completed publication's manifest and coverage. */
export const state = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await stateRow(ctx);
    if (!row) return null;
    const { pending } = row;
    return {
      revision: row.revision,
      snapshotId: row.snapshotId ?? null,
      count: row.count,
      setDigest: row.setDigest,
      metadataUrl: row.metadata ? await ctx.storage.getUrl(row.metadata) : null,
      pending: pending
        ? {
            snapshotId: pending.snapshotId,
            revision: pending.revision,
            count: pending.count,
            setDigest: pending.setDigest,
            startedAt: pending.startedAt,
          }
        : null,
    };
  },
});

/** One page of the live rows' keys, hashes and tiles, in key order. */
export const hashes = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, limit = HASH_PAGE_LIMIT }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > HASH_PAGE_LIMIT)
      throw new Error(`Hash pages hold 1-${HASH_PAGE_LIMIT} rows`);
    const result = await ctx.db
      .query('livePlaces')
      .withIndex('by_key')
      .paginate({ cursor, numItems: limit });
    return {
      page: result.page.map(({ key, hash, tile }) => ({ key, hash, tile })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * One page of the tiles that hold activities, from `activityPlaceTiles` in
 * tile order: each tile with the number of its rows on the page, that is of
 * activities whose current match read it. A tile that continues on the next
 * page is listed on both; the reader sums them. Names no owner or activity:
 * the publisher's region selection needs only where the demand is.
 */
export const demandTiles = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, limit = DEMAND_PAGE_LIMIT }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEMAND_PAGE_LIMIT)
      throw new Error(`Demand pages read 1-${DEMAND_PAGE_LIMIT} rows`);
    const result = await ctx.db
      .query('activityPlaceTiles')
      .withIndex('by_tile_owner')
      .paginate({ cursor, numItems: limit });
    const activities = new Map<string, number>();
    for (const { tile } of result.page)
      activities.set(tile, (activities.get(tile) ?? 0) + 1);
    return {
      page: [...activities].map(([tile, count]) => ({
        tile,
        activities: count,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** One page of a live tile, shaped for `readMatchingTiles`. During an apply
 * it holds old and new rows; the re-match walk corrects matches that read
 * them. */
export const tilePage = internalQuery({
  args: { tile: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems > 256) throw new Error('Tile page limit');
    const result = await ctx.db
      .query('livePlaces')
      .withIndex('by_tile_key', (q) => q.eq('tile', args.tile))
      .paginate(args.paginationOpts);
    return {
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      page: result.page.map((row) => ({
        key: row.key,
        longitude: row.place.location.longitude,
        latitude: row.place.location.latitude,
        metadata: row.place,
      })),
    };
  },
});

/**
 * Start applying an artifact, or resume the one being applied.
 *
 * `expectCurrent` is the completed snapshot the sender diffed against. A
 * pending apply of another artifact is only discarded when `replacePending`
 * names it: its rows stay as they are, and its tile changes carry over to
 * the new apply, which gets the same revision. `metadata` is a stored file
 * with the artifact's manifest and coverage.
 */
export const beginApply = internalMutation({
  args: {
    expectCurrent: v.union(v.string(), v.null()),
    snapshotId: v.string(),
    metadata: v.id('_storage'),
    count: v.number(),
    setDigest: v.string(),
    replacePending: v.optional(v.string()),
    /** For the operator's record (`placePublications`) only. */
    source: v.optional(v.object({ dataAsOf: v.number(), regions: v.number() })),
  },
  handler: async (ctx, args) => {
    checkIdentity(args);
    let row = await stateRow(ctx);
    if (!row) {
      const id = await ctx.db.insert('placeCatalogueState', {
        revision: 0,
        count: 0,
        setDigest: EMPTY_SET_DIGEST,
      });
      row = (await ctx.db.get('placeCatalogueState', id))!;
    }
    const current = row.snapshotId ?? null;
    const { pending } = row;
    // A refused sender's metadata copy is not needed.
    const refuse = async (
      reason: 'current_changed' | 'pending_other' | 'already_current',
    ) => {
      if (args.metadata !== row.metadata && args.metadata !== pending?.metadata)
        await ctx.storage.delete(args.metadata);
      return {
        ok: false as const,
        reason,
        current,
        pending: pending?.snapshotId ?? null,
      };
    };
    if (args.expectCurrent !== current) return refuse('current_changed');
    if (pending?.snapshotId === args.snapshotId) {
      if (pending.count !== args.count || pending.setDigest !== args.setDigest)
        throw new Error('Live catalogue artifact identity differs');
      // The first sender's metadata stays; this copy is not needed.
      if (pending.metadata !== args.metadata)
        await ctx.storage.delete(args.metadata);
      return { ok: true as const, revision: pending.revision, resumed: true };
    }
    if (args.replacePending !== pending?.snapshotId)
      return refuse('pending_other');
    if (!pending && args.snapshotId === current)
      return refuse('already_current');
    if (
      pending &&
      pending.metadata !== args.metadata &&
      pending.metadata !== row.metadata
    )
      await ctx.storage.delete(pending.metadata);
    const revision = row.revision + 1;
    await ctx.db.patch('placeCatalogueState', row._id, {
      pending: {
        snapshotId: args.snapshotId,
        revision,
        metadata: args.metadata,
        count: args.count,
        setDigest: args.setDigest,
        startedAt: Date.now(),
      },
    });
    const publication = await publicationFor(ctx, revision);
    const { snapshotId, source } = args;
    // The tiles a replaced publication changed carry over, and their count.
    if (publication)
      await ctx.db.patch('placePublications', publication._id, {
        snapshotId,
        source,
      });
    else
      await ctx.db.insert('placePublications', {
        revision,
        snapshotId,
        source,
        tiles: 0,
        tilesDone: 0,
      });
    return { ok: true as const, revision, resumed: false };
  },
});

async function recordTiles(
  ctx: MutationCtx,
  revision: number,
  tiles: ReadonlySet<string>,
) {
  const seen = await Promise.all(
    [...tiles].map((tile) =>
      ctx.db
        .query('placeTileChanges')
        .withIndex('by_revision_tile', (q) =>
          q.eq('revision', revision).eq('tile', tile),
        )
        .unique(),
    ),
  );
  let added = 0;
  for (const [index, tile] of [...tiles].entries())
    if (!seen[index]) {
      await ctx.db.insert('placeTileChanges', { revision, tile });
      added++;
    }
  const publication = added > 0 && (await publicationFor(ctx, revision));
  if (publication)
    await ctx.db.patch('placePublications', publication._id, {
      tiles: publication.tiles + added,
    });
}

/**
 * Upsert and delete rows of the pending apply. An upsert whose row hash is
 * already live and a delete of an absent key change nothing. `tiles` are
 * further changed tiles: those where the coverage changed.
 */
export const applyBatch = internalMutation({
  args: {
    snapshotId: v.string(),
    upserts: v.array(place),
    deletes: v.array(v.string()),
    tiles: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const operations = args.upserts.length + args.deletes.length;
    if (
      operations > PLACE_BATCH_LIMIT ||
      args.tiles.length > TILE_BATCH_LIMIT ||
      operations + args.tiles.length === 0
    )
      throw new Error(
        `Live place batches hold up to ${PLACE_BATCH_LIMIT} writes and ${TILE_BATCH_LIMIT} tiles`,
      );
    const keys = new Set<string>();
    for (const key of [
      ...args.upserts.map((item) => item.id),
      ...args.deletes,
    ]) {
      if (!key || key.length > 64 || keys.has(key))
        throw new Error('Invalid or repeated place key');
      keys.add(key);
    }
    for (const { location } of args.upserts)
      if (
        !Number.isFinite(location.longitude) ||
        !Number.isFinite(location.latitude) ||
        Math.abs(location.longitude) > 180 ||
        Math.abs(location.latitude) > 90
      )
        throw new Error('Invalid place location');
    if (args.tiles.some((tile) => !/^\d+,\d+$/.test(tile)))
      throw new Error('Invalid tile');

    const row = await stateRow(ctx);
    const pending = row?.pending;
    if (!row || pending?.snapshotId !== args.snapshotId)
      return { ok: false as const, reason: 'not_pending' as const };
    const { revision } = pending;
    let { count, setDigest } = row;
    const changed = new Set(args.tiles);
    // Keys are distinct within a batch, so the rows can be read at once.
    const [hashes, upserted, deleted] = await Promise.all([
      Promise.all(args.upserts.map(rowHash)),
      Promise.all(args.upserts.map((item) => liveRow(ctx, item.id))),
      Promise.all(args.deletes.map((key) => liveRow(ctx, key))),
    ]);
    for (const [index, item] of args.upserts.entries()) {
      const hash = hashes[index]!;
      const tile = tileOf(item.location);
      const live = upserted[index];
      if (live?.hash === hash) continue;
      const fields = { key: item.id, tile, place: item, hash, revision };
      if (live) {
        await ctx.db.replace('livePlaces', live._id, fields);
        setDigest = removeFromSetDigest(setDigest, live.hash);
        changed.add(live.tile);
      } else {
        await ctx.db.insert('livePlaces', fields);
        count++;
      }
      setDigest = addToSetDigest(setDigest, hash);
      changed.add(tile);
    }
    for (const live of deleted) {
      if (!live) continue;
      await ctx.db.delete('livePlaces', live._id);
      count--;
      setDigest = removeFromSetDigest(setDigest, live.hash);
      changed.add(live.tile);
    }
    await recordTiles(ctx, revision, changed);
    if (count !== row.count || setDigest !== row.setDigest)
      await ctx.db.patch('placeCatalogueState', row._id, { count, setDigest });
    return { ok: true as const, count, setDigest };
  },
});

/**
 * Accept the pending apply when the rows match what `beginApply` announced,
 * and start the re-match walk over its changed tiles. Repeating it for the
 * completed artifact changes nothing.
 */
export const completeApply = internalMutation({
  args: { snapshotId: v.string() },
  handler: async (ctx, { snapshotId }) => {
    const row = await stateRow(ctx);
    const live = {
      count: row?.count ?? 0,
      setDigest: row?.setDigest ?? EMPTY_SET_DIGEST,
    };
    if (row && !row.pending && row.snapshotId === snapshotId)
      return { ok: true as const, revision: row.revision };
    const pending = row?.pending;
    if (!row || pending?.snapshotId !== snapshotId)
      return { ok: false as const, reason: 'not_pending' as const, ...live };
    if (pending.count !== row.count || pending.setDigest !== row.setDigest)
      return { ok: false as const, reason: 'mismatch' as const, ...live };
    await ctx.db.patch('placeCatalogueState', row._id, {
      revision: pending.revision,
      snapshotId,
      metadata: pending.metadata,
      pending: undefined,
    });
    const publication = await publicationFor(ctx, pending.revision);
    if (publication)
      await ctx.db.patch('placePublications', publication._id, {
        completedAt: Date.now(),
      });
    if (row.metadata && row.metadata !== pending.metadata)
      await ctx.storage.delete(row.metadata);
    await ctx.scheduler.runAfter(0, internal.catalogue.rematchTiles, {
      revision: pending.revision,
    });
    return { ok: true as const, revision: pending.revision };
  },
});
