import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { publishChange } from './activityWrites';
import {
  ownerFor,
  requireHead,
  requireWritableOwner,
  scopeFields,
} from './owners';

/** Hide old matches immediately, then durably publish their invalidations. */
export const select = internalMutation({
  args: {
    scope: v.object(scopeFields),
    catalogue: v.string(),
    matchingVersion: v.string(),
  },
  handler: async (ctx, { scope, catalogue, matchingVersion }) => {
    // Selected by the Postgres mirror, for the catalogue Postgres matched with.
    const owner = await requireWritableOwner(ctx, scope);
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
    const head = await requireHead(ctx, owner._id);
    await ctx.db.patch('owners', owner._id, { catalogue, matchingVersion });
    await ctx.db.patch('ownerHeads', head._id, { catalogueAfter: '' });
    await ctx.scheduler.runAfter(0, internal.catalogue.next, {
      scope,
      catalogue,
    });
    return true;
  },
});

/** Each transaction commits its cursor and schedules its continuation together. */
export const next = internalMutation({
  args: { scope: v.object(scopeFields), catalogue: v.string() },
  handler: async (ctx, { scope, catalogue }): Promise<{ done: boolean }> => {
    const owner = await ownerFor(ctx, scope.userId);
    // Revocation, handoff and a superseding catalogue make queued work a no-op.
    if (
      !owner ||
      owner.revoked ||
      owner.backend !== 'convex' ||
      owner.epoch !== scope.epoch ||
      owner.athleteId !== scope.athleteId ||
      owner.catalogue !== catalogue
    )
      return { done: true };
    const head = await requireHead(ctx, owner._id);
    const after = head.catalogueAfter;
    if (after === undefined) return { done: true };
    const limit = 16;
    const rows = await ctx.db
      .query('activities')
      .withIndex('by_owner_live_key', (q) =>
        q
          .eq('owner', owner._id)
          .eq('generation', owner.generation)
          .eq('deleted', false)
          .gt('key', after),
      )
      .take(limit);
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
      await publishChange(ctx, owner, row.dto.id, 'upsert');
    }
    const done = rows.length < limit;
    await ctx.db.patch('ownerHeads', head._id, {
      catalogueAfter: done ? undefined : rows.at(-1)!.key,
    });
    if (!done)
      await ctx.scheduler.runAfter(0, internal.catalogue.next, {
        scope,
        catalogue,
      });
    return { done };
  },
});
