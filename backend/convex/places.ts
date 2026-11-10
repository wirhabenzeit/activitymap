import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import {
  PLACE_BATCH_LIMIT,
  chainDigest,
  tileOf,
} from '../../src/server/places/catalogue-rows';
import type { Doc } from './_generated/dataModel';
import {
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { placeValidator as place } from './placeValidators';

/**
 * The place catalogue the matcher reads: the rows Postgres matches against
 * (not retired, not hidden) for one catalogue snapshot at one revision,
 * stored by quarter-degree tile. Place IDs are the Postgres place IDs, so
 * results computed here refer to the same places as results copied from
 * Postgres.
 *
 * A rowset is immutable. It is imported once, in ascending place-ID order, by
 * the catalogue mirror (src/server/convex-mirror/catalogue.ts): `begin`
 * records what is coming, `importBatch` appends rows after the last imported
 * ID and extends a digest over them, and `complete` accepts the rowset only
 * when the row count and the digest match the sender's. Until then nothing
 * reads it. A changed catalogue is a new dataset.
 */

const dataset = v.string();
function catalogueFor(ctx: QueryCtx, id: string) {
  return ctx.db
    .query('placeCatalogues')
    .withIndex('by_dataset', (q) => q.eq('dataset', id))
    .unique();
}

const progress = (row: Doc<'placeCatalogues'>) => ({
  snapshotId: row.snapshotId,
  revision: row.revision,
  count: row.count,
  imported: row.imported,
  after: row.after,
  digest: row.digest,
  complete: row.complete,
});

/** Import progress of a dataset, or null when it has not been started. */
export const state = internalQuery({
  args: { dataset },
  handler: async (ctx, args) => {
    const row = await catalogueFor(ctx, args.dataset);
    return row ? progress(row) : null;
  },
});

/** Start a dataset, or return the progress of one already started. `metadata`
 * is a stored file holding the catalogue manifest and coverage. */
export const begin = internalMutation({
  args: {
    dataset,
    snapshotId: v.string(),
    revision: v.string(),
    count: v.number(),
    metadata: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    if (
      !/^[0-9a-f]{64}$/.test(args.dataset) ||
      !Number.isSafeInteger(args.count) ||
      args.count < 0
    )
      throw new Error('Invalid catalogue dataset');
    const existing = await catalogueFor(ctx, args.dataset);
    if (existing) {
      if (
        existing.snapshotId !== args.snapshotId ||
        existing.revision !== args.revision ||
        existing.count !== args.count
      )
        throw new Error('Catalogue dataset identity differs');
      // The first sender's metadata stays; this copy is not needed.
      if (existing.metadata !== args.metadata)
        await ctx.storage.delete(args.metadata);
      return progress(existing);
    }
    const id = await ctx.db.insert('placeCatalogues', {
      ...args,
      imported: 0,
      after: '',
      digest: '',
      complete: false,
    });
    return progress((await ctx.db.get('placeCatalogues', id))!);
  },
});

/** Append rows that follow `after`. A batch sent for another position (a
 * repeat, or a second sender) changes nothing; the answer is the dataset's
 * progress either way, so the sender continues from there. */
export const importBatch = internalMutation({
  args: { dataset, after: v.string(), places: v.array(place) },
  handler: async (ctx, args) => {
    if (args.places.length < 1 || args.places.length > PLACE_BATCH_LIMIT)
      throw new Error(`Place batches hold 1-${PLACE_BATCH_LIMIT} rows`);
    const row = await catalogueFor(ctx, args.dataset);
    if (!row) throw new Error('Catalogue dataset not started');
    if (row.complete || row.after !== args.after) return progress(row);
    let last = args.after;
    for (const item of args.places) {
      if (
        !item.id ||
        item.id.length > 64 ||
        item.id <= last ||
        !Number.isFinite(item.location.longitude) ||
        !Number.isFinite(item.location.latitude) ||
        Math.abs(item.location.longitude) > 180 ||
        Math.abs(item.location.latitude) > 90
      )
        throw new Error('Invalid or unordered place row');
      last = item.id;
      await ctx.db.insert('places', {
        dataset: args.dataset,
        key: item.id,
        tile: tileOf(item.location),
        place: item,
      });
    }
    const imported = row.imported + args.places.length;
    if (imported > row.count) throw new Error('More rows than announced');
    await ctx.db.patch('placeCatalogues', row._id, {
      imported,
      after: last,
      digest: await chainDigest(row.digest, args.places),
    });
    return progress((await ctx.db.get('placeCatalogues', row._id))!);
  },
});

/** Accept a rowset whose count and digest match the sender's. */
export const complete = internalMutation({
  args: { dataset, digest: v.string() },
  handler: async (ctx, args) => {
    const row = await catalogueFor(ctx, args.dataset);
    if (!row) throw new Error('Catalogue dataset not started');
    if (!row.complete) {
      if (row.imported !== row.count || row.digest !== args.digest)
        throw new Error('Catalogue rowset is incomplete or differs');
      await ctx.db.patch('placeCatalogues', row._id, { complete: true });
    }
    return progress({ ...row, complete: true });
  },
});

/** One page of a complete rowset's tile, shaped for `readMatchingTiles`. */
export const tilePage = internalQuery({
  args: {
    dataset,
    tile: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems > 256) throw new Error('Tile page limit');
    const catalogue = await catalogueFor(ctx, args.dataset);
    if (!catalogue?.complete) throw new Error('Catalogue rowset unavailable');
    const result = await ctx.db
      .query('places')
      .withIndex('by_dataset_tile', (q) =>
        q.eq('dataset', args.dataset).eq('tile', args.tile),
      )
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
