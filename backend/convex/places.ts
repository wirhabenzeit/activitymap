import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import {
  LIVE_CATALOGUE,
  PLACE_BATCH_LIMIT,
  chainDigest,
  tileOf,
} from '../../src/server/places/catalogue-rows';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { placeValidator as place } from './placeValidators';

/**
 * The place catalogue the matcher reads: the places of one catalogue
 * snapshot under one row format, stored by quarter-degree tile. A place's ID
 * is derived from its OpenStreetMap object by the publisher
 * (src/server/places/catalogue-publish.ts).
 *
 * A rowset is immutable. It is imported once, in ascending place-ID order:
 * `begin` records what is coming, `importBatch` appends rows after the last
 * imported ID and extends a digest over them, and `complete` accepts the
 * rowset only when the row count and the digest match the sender's. Until
 * then nothing reads it. A changed catalogue is a new dataset.
 *
 * Rowsets are what libraries were matched against before the live catalogue
 * (convex/livePlaces.ts). An owner whose matching version names a rowset
 * keeps reading it until `catalogueWorker.adopt` moves it to the live
 * catalogue; `dropRowsets` removes them afterwards.
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

/** The catalogue a library that starts here is matched against, and the
 * one `catalogueWorker.adopt` moves libraries to: the live catalogue
 * (`LIVE_CATALOGUE`) once a publication of it has completed, before that
 * the newest complete rowset, or null. */
export async function latestCatalogue(
  ctx: QueryCtx,
): Promise<{ snapshotId: string; revision: string } | null> {
  if (await liveCompleted(ctx)) return { ...LIVE_CATALOGUE };
  const rows = await ctx.db.query('placeCatalogues').order('desc').take(8);
  const row = rows.find((candidate) => candidate.complete);
  return row ? { snapshotId: row.snapshotId, revision: row.revision } : null;
}

async function liveCompleted(ctx: QueryCtx) {
  const state = await ctx.db.query('placeCatalogueState').unique();
  return (state?.revision ?? 0) >= 1;
}

export const latest = internalQuery({ args: {}, handler: latestCatalogue });

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

const DROP_PAGE = 1024;

/**
 * Delete the rowsets once nothing matches against them any more: their
 * `places` rows first, then their `placeCatalogues` rows with their stored
 * files. Run by hand after the cutover to the live catalogue
 * (`convex run places:dropRowsets`); it continues by itself until nothing is
 * left. Returns what this step deleted and whether it continues.
 *
 * It refuses before a live publication has completed, and until the latest
 * adoption (`catalogueWorker.adopt`) has moved every library to the live
 * catalogue: until then owners still match against their rowset.
 */
export const dropRowsets = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!(await liveCompleted(ctx)))
      return { ok: false as const, reason: 'no_live_catalogue' as const };
    const adoption = await ctx.db.query('catalogueAdoptions').first();
    if (adoption?.snapshotId !== LIVE_CATALOGUE.snapshotId)
      return { ok: false as const, reason: 'not_adopted' as const };
    const places = await ctx.db.query('places').take(DROP_PAGE);
    for (const row of places) await ctx.db.delete('places', row._id);
    const catalogues =
      places.length < DROP_PAGE
        ? await ctx.db.query('placeCatalogues').take(DROP_PAGE - places.length)
        : [];
    for (const row of catalogues) {
      if (await ctx.db.system.get('_storage', row.metadata))
        await ctx.storage.delete(row.metadata);
      await ctx.db.delete('placeCatalogues', row._id);
    }
    const more = places.length + catalogues.length === DROP_PAGE;
    if (more) await ctx.scheduler.runAfter(0, internal.places.dropRowsets, {});
    return {
      ok: true as const,
      places: places.length,
      catalogues: catalogues.length,
      more,
    };
  },
});

/** Upload URLs for a catalogue's stored files (its manifest and coverage). */
export const uploadUrls = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    if (!Number.isSafeInteger(count) || count < 1 || count > 64)
      throw new Error('Upload URL batches hold 1-64 items');
    return Promise.all(
      Array.from({ length: count }, () => ctx.storage.generateUploadUrl()),
    );
  },
});
