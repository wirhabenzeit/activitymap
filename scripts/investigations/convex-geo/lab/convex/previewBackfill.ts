import { v } from 'convex/values';

import { PROJECTION_VERSION } from '../../../../../backend/convex/activityProjection';
import { internalMutation } from './_generated/server';
import { requireOwner } from './preview';
import { projectionSource, writeProjection } from './previewProjection';

const batchSize = 32;

/** Rebuild in ID order. Concurrent writes maintain the new projection even
 * while reads use the original implementation. Activation is atomic. */
export const next = internalMutation({
  args: { userId: v.string(), athleteId: v.number(), epoch: v.string() },
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx, args);
    if (owner.projectionVersion === PROJECTION_VERSION)
      return { done: true, count: 0, bytes: 0 };
    const checkpoint =
      owner.projectionBackfill?.version === PROJECTION_VERSION
        ? owner.projectionBackfill
        : { version: PROJECTION_VERSION, after: null, count: 0, bytes: 0 };
    const { after } = checkpoint;
    const rows = await ctx.db
      .query('previewActivities')
      .withIndex('owner_activity', (q) =>
        after === null
          ? q.eq('owner', owner._id)
          : q.eq('owner', owner._id).gt('id', after),
      )
      .take(batchSize);
    const source = await projectionSource(ctx, owner);
    const sizes = await Promise.all(
      rows.map((row) => writeProjection(ctx, owner, row, source)),
    );
    const count = checkpoint.count + rows.length;
    const bytes = checkpoint.bytes + sizes.reduce((sum, size) => sum + size, 0);
    const done = rows.length < batchSize;
    await ctx.db.patch(
      'previewOwners',
      owner._id,
      done
        ? {
            projectionVersion: PROJECTION_VERSION,
            projectionBackfill: undefined,
          }
        : {
            projectionBackfill: {
              ...checkpoint,
              after: rows.at(-1)!.id,
              count,
              bytes,
            },
          },
    );
    return { done, count, bytes };
  },
});
