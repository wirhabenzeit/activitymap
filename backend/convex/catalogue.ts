import { v } from 'convex/values';

import { internalMutation } from './_generated/server';
import { publishChange } from './activityWrites';
import { requireOwner, scopeFields } from './owners';

/** The operations layer publishes a new immutable catalogue identity first.
 * Every page hides matches against the previous identity immediately. */
export const select = internalMutation({
  args: {
    scope: v.object(scopeFields),
    catalogue: v.string(),
    matchingVersion: v.string(),
  },
  handler: async (ctx, { scope, catalogue, matchingVersion }) => {
    const owner = await requireOwner(ctx, scope);
    if (
      !/^[0-9a-f]{64}$/.test(catalogue) ||
      !/^[0-9a-f]{64}$/.test(matchingVersion)
    )
      throw new Error('Invalid catalogue identity');
    if (
      owner.catalogue === catalogue &&
      owner.matchingVersion === matchingVersion
    )
      return false;
    if (
      owner.catalogue === catalogue ||
      owner.matchingVersion === matchingVersion
    )
      throw new Error('Catalogue and matching version must advance together');
    await ctx.db.patch('owners', owner._id, {
      catalogue,
      matchingVersion,
      catalogueAfter: '',
    });
    return true;
  },
});

/** Publish pending changes in bounded batches. The matching worker replaces
 * them when a result for the current catalogue and recording arrives. */
export const next = internalMutation({
  args: { scope: v.object(scopeFields), catalogue: v.string() },
  handler: async (ctx, { scope, catalogue }) => {
    const owner = await requireOwner(ctx, scope);
    const after = owner.catalogueAfter;
    if (after === undefined || owner.catalogue !== catalogue)
      return { done: true };
    const limit = 16;
    const rows = await ctx.db
      .query('activities')
      .withIndex('by_owner_live_key', (q) =>
        q.eq('owner', owner._id).eq('deleted', false).gt('key', after),
      )
      .take(limit);
    let sequence = owner.sequence;
    for (const row of rows) {
      if (
        !row.dto ||
        !row.projection?.match ||
        row.projection.match.catalogue === catalogue
      )
        continue;
      await ctx.db.patch('activities', row._id, {
        projection: { ...row.projection, match: undefined },
      });
      await publishChange(ctx, { ...owner, sequence }, row.dto.id, 'upsert');
      sequence++;
    }
    const done = rows.length < limit;
    await ctx.db.patch('owners', owner._id, {
      catalogueAfter: done ? undefined : rows.at(-1)!.key,
    });
    return { done };
  },
});
