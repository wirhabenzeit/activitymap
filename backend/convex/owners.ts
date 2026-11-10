import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internalMutation, internalQuery } from './_generated/server';
import { PROJECTION_VERSION } from './activityProjection';
import {
  type Writer,
  actorFields,
  scopeFields,
  writerValidator,
} from './ownerScope';
import { zeroCounts } from './statsShape';

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
    owner.revoked
  )
    throw new Error('Activity owner unavailable');
  return owner;
}

/** Who writes the owner's library; Postgres until a handoff says otherwise. */
export function writerOf(owner: Doc<'owners'>): Writer {
  return owner.writer ?? 'postgres';
}

/**
 * The owner, for a write by `writer`. Every write to an owner's library
 * goes through this in its own transaction, so a writer that picked its
 * work before a handoff is refused when it publishes after it. Copies from
 * Postgres (the mirror and the importer) write as `postgres`, the default.
 */
export async function requireWritableOwner(
  ctx: QueryCtx,
  scope: { userId: string; athleteId: string; epoch: string },
  writer: Writer = 'postgres',
) {
  const owner = await requireOwner(ctx, scope);
  if (writerOf(owner) !== writer)
    throw new Error('Activity owner is written by another store');
  return owner;
}

export async function requireHead(ctx: QueryCtx, owner: Doc<'owners'>['_id']) {
  const head = await ctx.db
    .query('ownerHeads')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .unique();
  if (!head) throw new Error('Activity sync head unavailable');
  return head;
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
  handler: async (
    ctx,
    { expectedEpoch, ...args },
  ): Promise<Doc<'owners'>['_id']> => {
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
        projectionVersion: PROJECTION_VERSION,
      });
      await ctx.db.insert('ownerHeads', {
        owner: id,
        sequence: 0,
        retentionFloor: 0,
      });
      await ctx.db.insert('ownerEpochs', { owner: id, epoch: args.epoch });
      // A new owner has no activities yet; writes keep its counts current.
      await ctx.db.insert('ownerStats', { owner: id, counts: zeroCounts() });
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
    const head = await requireHead(ctx, prior._id);
    // Not during a writer handoff: setWriter resumes it afterwards.
    if (
      args.backend === 'convex' &&
      head.catalogueAfter !== undefined &&
      writerOf(prior) !== 'handoff'
    )
      await ctx.scheduler.runAfter(0, internal.catalogue.next, {
        scope: {
          userId: args.userId,
          athleteId: args.athleteId,
          epoch: args.epoch,
        },
        catalogue: args.catalogue,
        writer: writerOf(prior),
      });
    return prior._id;
  },
});

/**
 * Move an owner to another writer if it is still at `expectedEpoch` (0 for
 * an owner that was never handed off). Returns the new epoch, or null when
 * the epoch has moved on. Mirrors `setWriter` on the Postgres user.
 */
export const setWriter = internalMutation({
  args: {
    ...actorFields,
    writer: writerValidator,
    expectedEpoch: v.number(),
  },
  handler: async (
    ctx,
    { userId, athleteId, writer, expectedEpoch },
  ): Promise<number | null> => {
    const owner = await ownerFor(ctx, userId);
    if (!owner || owner.revoked || owner.athleteId !== athleteId)
      throw new Error('Activity owner unavailable');
    if ((owner.writerEpoch ?? 0) !== expectedEpoch) return null;
    const writerEpoch = expectedEpoch + 1;
    await ctx.db.patch('owners', owner._id, { writer, writerEpoch });
    // An unfinished catalogue invalidation stopped with the previous writer
    // (catalogue.next). The store that writes next finishes it; during a
    // handoff it waits.
    const head = await requireHead(ctx, owner._id);
    if (
      writer !== 'handoff' &&
      owner.backend === 'convex' &&
      head.catalogueAfter !== undefined
    )
      await ctx.scheduler.runAfter(0, internal.catalogue.next, {
        scope: { userId, athleteId, epoch: owner.epoch },
        catalogue: owner.catalogue,
        writer,
      });
    return writerEpoch;
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
