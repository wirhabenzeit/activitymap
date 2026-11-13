import { v } from 'convex/values';

import { activityDTOSchema } from '../../../../../src/contracts/v1/activity';
import { internalMutation } from './_generated/server';
import { activityFor, recordPreviewChange } from './previewRows';

/** Bounded initial metadata for disposable full-cache sync proofs only. */
export const seed = internalMutation({
  args: { userId: v.string(), epoch: v.string(), activities: v.array(v.any()) },
  handler: async (ctx, args) => {
    const owner = await ctx.db
      .query('previewOwners')
      .withIndex('user', (q) => q.eq('userId', args.userId))
      .unique();
    if (
      !owner ||
      !owner.userId.startsWith('fixture-production-sync-') ||
      owner.epoch !== args.epoch ||
      !owner.fixtureAccount ||
      owner.retainedRun ||
      owner.erasing ||
      args.activities.length > 100
    )
      throw new Error('Invalid disposable benchmark scope');
    if (JSON.stringify(args.activities).length > 600_000)
      throw new Error('Benchmark seed batch too large');
    for (const value of args.activities) {
      const {
        streams: _streams,
        placeMatches: _matches,
        ...dto
      } = activityDTOSchema.parse(value);
      const id = Number(dto.id);
      if (
        dto.athlete !== String(owner.athleteId) ||
        !Number.isSafeInteger(id) ||
        id < 1 ||
        String(id) !== dto.id ||
        JSON.stringify(dto).length > 64 * 1024
      )
        throw new Error('Invalid benchmark metadata');
      if (await activityFor(ctx, owner._id, id))
        throw new Error('Benchmark row already exists');
      await ctx.db.insert('previewActivities', { owner: owner._id, id, dto });
      await recordPreviewChange(ctx, owner._id, 'activity', dto.id, 'upsert');
    }
    return args.activities.length;
  },
});
