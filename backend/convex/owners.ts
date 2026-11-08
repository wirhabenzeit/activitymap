import { v } from 'convex/values';

import type { QueryCtx } from './_generated/server';
import { internalMutation, internalQuery } from './_generated/server';
import { PROJECTION_VERSION } from './activityProjection';
import { actorFields, scopeFields } from './ownerScope';

export { scopeFields } from './ownerScope';

export function idKey(value: string) {
  if (!/^[1-9][0-9]{0,19}$/.test(value))
    throw new Error('Invalid external activity or athlete ID');
  return value.padStart(20, '0');
}

export function ownerFor(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query('owners')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
}

export async function requireOwner(
  ctx: QueryCtx,
  scope: {
    userId: string;
    athleteId: string;
    epoch: string;
  },
) {
  const owner = await ownerFor(ctx, scope.userId);
  if (
    !owner ||
    owner.athleteId !== scope.athleteId ||
    owner.epoch !== scope.epoch ||
    owner.backend !== 'convex' ||
    owner.revoked ||
    owner.projectionVersion !== PROJECTION_VERSION
  )
    throw new Error('Activity owner unavailable');
  return owner;
}

/** Internal handoff boundary. The migration coordinator owns the transition. */
export const provision = internalMutation({
  args: {
    ...scopeFields,
    backend: v.union(v.literal('postgres'), v.literal('convex')),
    expectedEpoch: v.optional(v.string()),
    generation: v.string(),
    catalogue: v.string(),
    matchingVersion: v.string(),
  },
  handler: async (ctx, { expectedEpoch, ...args }) => {
    idKey(args.athleteId);
    if (
      !args.userId ||
      args.userId.length > 128 ||
      !/^[A-Za-z0-9_-]{16,80}$/.test(args.epoch) ||
      !/^[A-Za-z0-9_-]{16,80}$/.test(args.generation) ||
      !/^[0-9a-f]{64}$/.test(args.catalogue) ||
      !/^[0-9a-f]{64}$/.test(args.matchingVersion)
    )
      throw new Error('Invalid owner assignment');

    const prior = await ownerFor(ctx, args.userId);
    if (!prior) {
      if (expectedEpoch !== undefined)
        throw new Error('Owner assignment unavailable');
      const id = await ctx.db.insert('owners', {
        ...args,
        revoked: false,
        sequence: 0,
        projectionVersion: PROJECTION_VERSION,
      });
      await ctx.db.insert('ownerEpochs', { owner: id, epoch: args.epoch });
      return id;
    }
    if (
      prior.revoked ||
      prior.athleteId !== args.athleteId ||
      prior.generation !== args.generation ||
      prior.catalogue !== args.catalogue ||
      prior.matchingVersion !== args.matchingVersion
    )
      throw new Error('Invalid owner assignment transition');
    if (prior.backend === args.backend && prior.epoch === args.epoch)
      return prior._id;
    const seen = await ctx.db
      .query('ownerEpochs')
      .withIndex('by_owner_epoch', (q) =>
        q.eq('owner', prior._id).eq('epoch', args.epoch),
      )
      .unique();
    if (expectedEpoch !== prior.epoch || prior.epoch === args.epoch || seen)
      throw new Error('Owner routing epoch changed or reused');
    await ctx.db.insert('ownerEpochs', { owner: prior._id, epoch: args.epoch });
    await ctx.db.patch('owners', prior._id, {
      backend: args.backend,
      epoch: args.epoch,
    });
    return prior._id;
  },
});

export const assignment = internalQuery({
  args: actorFields,
  handler: async (ctx, actor) => {
    const owner = await ownerFor(ctx, actor.userId);
    if (!owner) return { backend: 'postgres' as const, epoch: null };
    if (owner.revoked || owner.athleteId !== actor.athleteId)
      throw new Error('Activity owner unavailable');
    return { backend: owner.backend, epoch: owner.epoch };
  },
});

export const revoke = internalMutation({
  args: scopeFields,
  handler: async (ctx, scope) => {
    const owner = await ownerFor(ctx, scope.userId);
    if (owner?.epoch === scope.epoch && owner.athleteId === scope.athleteId)
      await ctx.db.patch('owners', owner._id, { revoked: true });
  },
});
