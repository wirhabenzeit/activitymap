import { v } from 'convex/values';

import { activityDTOSchema } from '~/contracts/v1/activity';

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { requireOwner } from './preview';
import { activityFor, recordPreviewChange } from './previewRows';

const scope = { userId: v.string(), athleteId: v.number(), epoch: v.string() };

/** Admin-only attachment. Does not alter recordings, expiry, or benchmark results. */
export const register = internalMutation({
  args: {
    ...scope,
    run: v.id('matchingRuns'),
    sourceUserId: v.string(),
    manifestHash: v.string(),
    matchingVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get('matchingRuns', args.run);
    const source = await ctx.db
      .query('matchingOwners')
      .withIndex('run_user', (q) =>
        q.eq('run', args.run).eq('userId', args.sourceUserId),
      )
      .unique();
    if (
      !run ||
      run.state !== 'ready' ||
      run.fixtureAccount ||
      !source ||
      run.manifestHash !== args.manifestHash ||
      source.generation !== run.generation ||
      (run.expiresAt !== undefined && run.expiresAt <= Date.now()) ||
      !Number.isSafeInteger(args.athleteId) ||
      args.athleteId < 1 ||
      !/^[A-Za-z0-9_-]{16,80}$/.test(args.epoch) ||
      !/^[0-9a-f]{64}$/.test(args.matchingVersion)
    )
      throw new Error('Invalid retained library');
    const existing = await ctx.db
      .query('previewOwners')
      .withIndex('user', (q) => q.eq('userId', args.userId))
      .unique();
    const value = {
      userId: args.userId,
      athleteId: args.athleteId,
      epoch: args.epoch,
      retainedRun: run._id,
      retainedOwner: source._id,
      matchingVersion: args.matchingVersion,
    };
    if (existing) {
      if (
        existing.erasing ||
        existing.fixtureAccount ||
        existing.athleteId !== args.athleteId ||
        existing.retainedRun !== run._id ||
        existing.retainedOwner !== source._id
      )
        throw new Error('Preview binding cannot change');
      await ctx.db.patch('previewOwners', existing._id, value);
      return existing._id;
    }
    return ctx.db.insert('previewOwners', { ...value, sequence: 0 });
  },
});

export const publish = internalMutation({
  args: {
    ...scope,
    records: v.array(v.object({ index: v.number(), activity: v.any() })),
  },
  handler: async (ctx, { records, ...scope }) => {
    const owner = await requireOwner(ctx, scope);
    if (
      !owner.retainedRun ||
      !owner.retainedOwner ||
      records.length < 1 ||
      records.length > 32
    )
      throw new Error('Invalid retained import batch');
    for (const { index, activity } of records) {
      const {
        streams: _streams,
        placeMatches: _matches,
        ...dto
      } = activityDTOSchema.parse(activity);
      const id = Number(dto.id);
      const item = await ctx.db
        .query('matchingItems')
        .withIndex('run_index', (q) =>
          q.eq('run', owner.retainedRun!).eq('index', index),
        )
        .unique();
      const target =
        item && (await ctx.db.get('recordingTargets', item.target));
      if (
        !item ||
        item.owner !== owner.retainedOwner ||
        !target?.current ||
        target.owner !== owner.retainedOwner ||
        target.key !== dto.id ||
        dto.athlete !== String(owner.athleteId) ||
        !Number.isSafeInteger(id) ||
        String(id) !== dto.id ||
        id < 1 ||
        new TextEncoder().encode(JSON.stringify(dto)).length > 64 * 1024
      )
        throw new Error('Activity does not belong to retained library');
      const prior = await activityFor(ctx, owner._id, id);
      if (
        prior &&
        JSON.stringify(prior.dto) === JSON.stringify(dto) &&
        prior.target === target._id
      )
        continue;
      if (prior)
        await ctx.db.patch('previewActivities', prior._id, {
          dto,
          target: target._id,
        });
      else
        await ctx.db.insert('previewActivities', {
          owner: owner._id,
          id,
          dto,
          target: target._id,
        });
      await recordPreviewChange(ctx, owner._id, 'activity', dto.id, 'upsert');
    }
    return records.length;
  },
});

/** Metadata follows the source run's retention; files remain owned by the replay. */
export const armExpiry = internalMutation({
  args: scope,
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx, args);
    const run =
      owner.retainedRun &&
      (await ctx.db.get('matchingRuns', owner.retainedRun));
    if (!run?.expiresAt) throw new Error('Retained preview requires an expiry');
    await ctx.scheduler.runAt(run.expiresAt, internal.previewLibrary.expire, {
      owner: owner._id,
    });
    return run.expiresAt;
  },
});

export const expire = internalMutation({
  args: { owner: v.id('previewOwners') },
  handler: async (ctx, { owner: id }) => {
    const owner = await ctx.db.get('previewOwners', id);
    if (!owner?.retainedRun || owner.erasing) return;
    const run = await ctx.db.get('matchingRuns', owner.retainedRun);
    if (
      run &&
      run.state !== 'erasing' &&
      run.expiresAt &&
      run.expiresAt > Date.now()
    ) {
      await ctx.scheduler.runAt(run.expiresAt, internal.previewLibrary.expire, {
        owner: id,
      });
      return;
    }
    await ctx.db.patch('previewOwners', id, { erasing: true });
    await ctx.scheduler.runAfter(0, internal.preview.eraseBatch, { owner: id });
  },
});
