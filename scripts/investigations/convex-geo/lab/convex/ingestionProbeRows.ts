import { v } from 'convex/values';

import { internalMutation, internalQuery } from './_generated/server';
import { reserve } from './ingestion/budget';

export const account = internalQuery({
  args: { account: v.id('ingestionAccounts') },
  handler: async (ctx, { account }) => {
    const owner = await ctx.db.get('ingestionAccounts', account);
    if (!owner) return null;
    const jobs = await ctx.db
      .query('ingestionJobs')
      .withIndex('account_key', (q) => q.eq('account', account))
      .take(100);
    const receipts = await ctx.db
      .query('ingestionReceipts')
      .withIndex('account_receipt', (q) => q.eq('account', account))
      .take(100);
    const fixtures = await ctx.db
      .query('ingestionFixtures')
      .withIndex('account_key', (q) => q.eq('account', account))
      .take(100);
    return {
      owner,
      jobs: jobs.length,
      receipts: receipts.length,
      fixtures: fixtures.length,
    };
  },
});

export const budget = internalQuery({
  args: { app: v.string() },
  handler: (ctx, { app }) =>
    ctx.db
      .query('ingestionBudgets')
      .withIndex('app_window', (q) => q.eq('app', app))
      .take(4),
});

export const files = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const rows = await ctx.db.system
      .query('_storage')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', since))
      .take(100);
    if (rows.length === 100)
      throw new Error('Fixture file audit exceeded its bound');
    return rows.filter((row) =>
      row.contentType?.startsWith('application/vnd.activitymap.recording.'),
    );
  },
});

export const workerState = internalQuery({
  args: { worker: v.id('_scheduled_functions') },
  handler: async (ctx, { worker }) =>
    (await ctx.db.system.get('_scheduled_functions', worker))?.state.kind ??
    null,
});

export const attempts = internalQuery({
  args: { since: v.number() },
  handler: (ctx, { since }) =>
    ctx.db
      .query('recordingAttempts')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', since))
      .take(100),
});

export const quotaCap = internalMutation({
  args: { app: v.string() },
  handler: async (ctx, { app }) => {
    if (!app.startsWith('fixture-ingestion-probe-'))
      throw new Error('Only probe applications');
    // Freeze the wall clock within this single transaction to isolate the cap.
    const now = Date.now();
    for (let i = 0; i < 75; i++) {
      if ((await reserve(ctx, app, true, now)) !== null)
        throw new Error('Early quota exhaustion');
    }
    const blockedRead = await reserve(ctx, app, true, now);
    const allowedRefresh = await reserve(ctx, app, false, now);
    return { blockedRead, allowedRefresh, now };
  },
});

export const dispose = internalMutation({
  args: { app: v.string() },
  handler: async (ctx, { app }) => {
    if (!app.startsWith('fixture-ingestion-probe-'))
      throw new Error('Only probe applications can be removed');
    const accounts = await ctx.db
      .query('ingestionAccounts')
      .withIndex('app', (q) => q.eq('app', app))
      .take(16);
    for (const account of accounts) {
      if (
        account.state !== 'revoked' ||
        (await ctx.db
          .query('ingestionJobs')
          .withIndex('account_key', (q) => q.eq('account', account._id))
          .first()) ||
        (await ctx.db
          .query('ingestionReceipts')
          .withIndex('account_receipt', (q) => q.eq('account', account._id))
          .first()) ||
        (await ctx.db
          .query('ingestionFixtures')
          .withIndex('account_key', (q) => q.eq('account', account._id))
          .first())
      ) {
        throw new Error('Fixture account erasure is incomplete');
      }
      await ctx.db.delete('ingestionAccounts', account._id);
    }
    const windows = await ctx.db
      .query('ingestionBudgets')
      .withIndex('app_window', (q) => q.eq('app', app))
      .take(4);
    for (const window of windows)
      await ctx.db.delete('ingestionBudgets', window._id);
  },
});
