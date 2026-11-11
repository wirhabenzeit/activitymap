import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import { actorFields } from './ownerScope';
import { ownerFor } from './owners';

/**
 * Erasing an account's library here. The app decides that an account is to
 * be erased (the owner deleted it, or its provider access was revoked and
 * the retention period is over) and calls `start` in the same transaction
 * that deletes the account in Postgres; if this call fails, that
 * transaction is rolled back and tried again later.
 *
 * `start` revokes the owner, which fences everything at once: no read,
 * write, job or sweep works for a revoked owner, and nothing can recreate
 * what is being removed. `step` then deletes the owner's documents and
 * stored recordings in bounded batches, and the owner record last. After
 * that the user ID is unknown here, as if it had never had a library.
 */

const ACTIVITIES_PER_STEP = 32;
const DOCUMENTS_PER_STEP = 128;

export const start = internalMutation({
  args: actorFields,
  handler: async (ctx, { userId, athleteId }): Promise<boolean> => {
    const owner = await ownerFor(ctx, userId);
    if (!owner) return false;
    if (owner.athleteId !== athleteId)
      throw new Error('The owner belongs to another athlete');
    if (!owner.revoked)
      await ctx.db.patch('owners', owner._id, { revoked: true });
    await ctx.scheduler.runAfter(0, internal.erasure.step, {
      owner: owner._id,
    });
    return true;
  },
});

/** Delete one batch of a revoked owner's data; the owner itself once
 * nothing else is left. Returns whether the owner is gone. */
export const step = internalMutation({
  args: { owner: v.id('owners') },
  handler: async (ctx, args): Promise<boolean> => {
    const owner = await ctx.db.get('owners', args.owner);
    // Only ever a revoked owner: `start` is the one way in.
    if (!owner?.revoked) return !owner;
    const id: Id<'owners'> = owner._id;
    let removed = 0;

    const activities = await ctx.db
      .query('activities')
      .withIndex('by_owner_key', (q) => q.eq('owner', id))
      .take(ACTIVITIES_PER_STEP);
    for (const activity of activities) {
      const recording =
        activity.recording &&
        (await ctx.db.get('recordings', activity.recording));
      if (recording) {
        if (await ctx.db.system.get('_storage', recording.file))
          await ctx.storage.delete(recording.file);
        await ctx.db.delete('recordings', recording._id);
      }
      await ctx.db.delete('activities', activity._id);
      removed++;
    }

    for (const doc of await ctx.db
      .query('photos')
      .withIndex('by_owner_key', (q) => q.eq('owner', id))
      .take(DOCUMENTS_PER_STEP)) {
      await ctx.db.delete('photos', doc._id);
      removed++;
    }
    for (const doc of await ctx.db
      .query('photoSets')
      .withIndex('by_owner_activity', (q) => q.eq('owner', id))
      .take(DOCUMENTS_PER_STEP)) {
      await ctx.db.delete('photoSets', doc._id);
      removed++;
    }
    for (const doc of await ctx.db
      .query('changes')
      .withIndex('by_owner_sequence', (q) => q.eq('owner', id))
      .take(DOCUMENTS_PER_STEP)) {
      await ctx.db.delete('changes', doc._id);
      removed++;
    }
    for (const doc of await ctx.db
      .query('ingestionJobs')
      .withIndex('by_owner_activity', (q) => q.eq('owner', id))
      .take(DOCUMENTS_PER_STEP)) {
      await ctx.db.delete('ingestionJobs', doc._id);
      removed++;
    }
    for (const doc of await ctx.db
      .query('ingestionSweeps')
      .withIndex('by_owner', (q) => q.eq('owner', id))
      .take(DOCUMENTS_PER_STEP)) {
      await ctx.db.delete('ingestionSweeps', doc._id);
      removed++;
    }
    for (const doc of await ctx.db
      .query('providerEvents')
      .withIndex('by_owner_event', (q) => q.eq('owner', id))
      .take(DOCUMENTS_PER_STEP)) {
      await ctx.db.delete('providerEvents', doc._id);
      removed++;
    }
    for (const doc of await ctx.db
      .query('shadowMatches')
      .withIndex('by_owner_activity', (q) => q.eq('owner', id))
      .take(DOCUMENTS_PER_STEP)) {
      await ctx.db.delete('shadowMatches', doc._id);
      removed++;
    }
    for (const doc of await ctx.db
      .query('shadowMatchRuns')
      .withIndex('by_owner', (q) => q.eq('owner', id))
      .take(DOCUMENTS_PER_STEP)) {
      await ctx.db.delete('shadowMatchRuns', doc._id);
      removed++;
    }

    if (removed > 0) {
      await ctx.scheduler.runAfter(0, internal.erasure.step, args);
      return false;
    }
    // Nothing of the library is left: the records about the owner go last.
    for (const doc of await ctx.db
      .query('ownerEpochs')
      .withIndex('by_owner_epoch', (q) => q.eq('owner', id))
      .collect())
      await ctx.db.delete('ownerEpochs', doc._id);
    for (const doc of await ctx.db
      .query('ownerStats')
      .withIndex('by_owner', (q) => q.eq('owner', id))
      .collect())
      await ctx.db.delete('ownerStats', doc._id);
    for (const doc of await ctx.db
      .query('ownerHeads')
      .withIndex('by_owner', (q) => q.eq('owner', id))
      .collect())
      await ctx.db.delete('ownerHeads', doc._id);
    await ctx.db.delete('owners', id);
    return true;
  },
});

/** Whether a user still has anything here, for an operator:
 * `convex run erasure:status '{"userId":"<userId>"}'`. */
export const status = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const owner = await ownerFor(ctx, userId);
    return owner ? { revoked: owner.revoked } : null;
  },
});
