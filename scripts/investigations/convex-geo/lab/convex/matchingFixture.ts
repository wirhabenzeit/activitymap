import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalMutation, internalQuery } from './_generated/server';
import { dispatch } from './matchingGroups';

export const enqueue = internalMutation({
  args: {
    job: v.id('ingestionJobs'),
    version: v.number(),
    generation: v.number(),
  },
  handler: async (ctx, { job: id, version, generation }) => {
    const job = await ctx.db.get('ingestionJobs', id);
    if (
      !job ||
      job.deleted ||
      job.generation !== generation ||
      job.version !== version ||
      job.committedVersion !== version ||
      !job.target
    )
      return;
    const account = await ctx.db.get('ingestionAccounts', job.account);
    if (
      account?.state !== 'active' ||
      account.generation !== generation ||
      !account.matchingCatalogue ||
      !(await ctx.db.get('matchingCatalogues', account.matchingCatalogue))
    )
      return;
    const target = await ctx.db.get('recordingTargets', job.target);
    const recording = target?.current
      ? await ctx.db.get('recordingManifests', target.current)
      : null;
    if (
      !target ||
      !recording ||
      target.owner !== account._id ||
      target.key !== job.key ||
      target.sourceVersion !== `fixture-v1:${version}`
    )
      return;

    let run = await ctx.db
      .query('matchingRuns')
      .withIndex('fixture_account', (q) => q.eq('fixtureAccount', account._id))
      .unique();
    if (!run) {
      const id = await ctx.db.insert('matchingRuns', {
        label: `fixture:${account._id}`,
        generation: String(generation),
        fixtureAccount: account._id,
        manifestHash: '',
        expected: 0,
        imported: 0,
        catalogue: account.matchingCatalogue,
        state: 'ready',
      });
      await ctx.db.insert('matchingOwners', {
        run: id,
        userId: account._id,
        generation: String(generation),
        sequence: 0,
      });
      run = (await ctx.db.get('matchingRuns', id))!;
    }
    if (
      run.state !== 'ready' ||
      run.generation !== String(generation) ||
      run.catalogue !== account.matchingCatalogue
    )
      return;
    const duplicate = await ctx.db
      .query('matchingItems')
      .withIndex('fixture_recording', (q) =>
        q.eq('fixtureRecording', recording._id),
      )
      .unique();
    if (duplicate) return;
    const owner = await ctx.db
      .query('matchingOwners')
      .withIndex('run_user', (q) =>
        q.eq('run', run!._id).eq('userId', account._id),
      )
      .unique();
    if (!owner) throw new Error('Matching fixture owner missing');
    const index = run.imported;
    await ctx.db.insert('matchingItems', {
      run: run._id,
      index,
      owner: owner._id,
      target: target._id,
      originalRevision: String(recording.revision),
      fixtureJob: job._id,
      fixtureVersion: version,
      fixtureRecording: recording._id,
      locationHint: {},
      samples: recording.manifest.counts.latlng ?? 0,
      phase: 'pending',
    });
    const group = await ctx.db.insert('matchingGroups', {
      run: run._id,
      mode: 'single',
      ordinal: index,
      items: [index],
      parallelism: 1,
      state: 'pending',
      attempt: 1,
      leaseUntil: 0,
    });
    await ctx.db.patch('matchingRuns', run._id, { imported: index + 1 });
    await dispatch(ctx, group, 1);
  },
});

export const current = internalQuery({
  args: { account: v.id('ingestionAccounts'), key: v.string() },
  handler: async (ctx, { account, key }) => {
    const owner = await ctx.db.get('ingestionAccounts', account);
    if (owner?.state !== 'active' || !owner.matchingCatalogue) return null;
    const job = await ctx.db
      .query('ingestionJobs')
      .withIndex('account_key', (q) => q.eq('account', account).eq('key', key))
      .unique();
    const target = job?.target
      ? await ctx.db.get('recordingTargets', job.target)
      : null;
    if (
      !target?.current ||
      target.owner !== account ||
      target.key !== key ||
      job?.committedVersion !== job?.version ||
      target.sourceVersion !== `fixture-v1:${job?.version}`
    )
      return null;
    const item = await ctx.db
      .query('matchingItems')
      .withIndex('fixture_recording', (q) =>
        q.eq('fixtureRecording', target.current),
      )
      .unique();
    return item ? { run: item.run, index: item.index } : null;
  },
});

export const erase = internalMutation({
  args: { account: v.id('ingestionAccounts') },
  handler: async (ctx, { account }) => {
    if ((await ctx.db.get('ingestionAccounts', account))?.state !== 'revoked')
      return;
    const run = await ctx.db
      .query('matchingRuns')
      .withIndex('fixture_account', (q) => q.eq('fixtureAccount', account))
      .unique();
    if (!run || run.state === 'erasing') return;
    await ctx.db.patch('matchingRuns', run._id, { state: 'erasing' });
    await ctx.scheduler.runAfter(0, internal.matchingReplay.eraseBatch, {
      run: run._id,
    });
  },
});
