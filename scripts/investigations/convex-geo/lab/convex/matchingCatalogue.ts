import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { internalMutation, internalQuery } from './_generated/server';
import { catalogueIdentity } from './matching/validators';

// Catalogue rows are imported once per immutable snapshot. The lab has no
// write endpoint for the public place dataset after its one-time CLI import.
export const verificationPage = internalQuery({
  args: { snapshotId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { snapshotId, paginationOpts }) => {
    if (paginationOpts.numItems > 512) throw new Error('Catalogue page limit');
    return ctx.db
      .query('places')
      .withIndex('dataset_key', (q) => q.eq('dataset', snapshotId))
      .paginate(paginationOpts);
  },
});

export const publish = internalMutation({
  args: {
    ...catalogueIdentity,
    count: v.number(),
    rowsHash: v.string(),
    artifact: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('matchingCatalogues')
      .withIndex('snapshot', (q) => q.eq('snapshotId', args.snapshotId))
      .collect();
    if (
      rows.some(
        (row) =>
          row.rowsHash !== args.rowsHash ||
          row.artifact !== args.artifact ||
          row.count !== args.count,
      )
    )
      throw new Error('Immutable catalogue content differs');
    const existing = rows.find(
      (row) => row.recipe === args.recipe && row.revision === args.revision,
    );
    return existing?._id ?? ctx.db.insert('matchingCatalogues', args);
  },
});
