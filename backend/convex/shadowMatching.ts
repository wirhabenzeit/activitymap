import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import { placeMatchValidator } from './activityValidators';
import { activityFor } from './activityWrites';
import { ownerFor } from './owners';

/**
 * Place matching on Convex, in shadow (docs/convex-writer-cutover.md, step
 * 3). A run walks one owner's library in activity-key order: a Node action
 * (`shadowMatchingWorker.run`) matches a small group of recordings against
 * the copied place catalogue and commits the results to `shadowMatches`,
 * which no client reads. When the walk ends, the results are compared with
 * the ones the mirror copied from Postgres (`activities.projection.match`)
 * and the outcome is kept on the run.
 *
 * Start a run for a shadow owner with
 * `convex run shadowMatching:start '{"userId":"<userId>"}'` and read it with
 * `shadowMatching:status`. A run that stopped with an error continues with
 * `shadowMatching:resume`.
 */

/** Activities read ahead per step; the worker takes a prefix of them. */
const READ_AHEAD = 24;
const COMPARE_PAGE = 16;

const liveActivities = (
  ctx: { db: import('./_generated/server').QueryCtx['db'] },
  owner: Doc<'owners'>,
  after: string,
) =>
  ctx.db
    .query('activities')
    .withIndex('by_owner_live_key', (q) =>
      q
        .eq('owner', owner._id)
        .eq('generation', owner.generation)
        .eq('deleted', false)
        .gt('key', after),
    );

export const start = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const owner = await ownerFor(ctx, userId);
    if (!owner || owner.revoked) throw new Error('Owner unavailable');
    // The newest complete rowset; the worker checks that it is the one the
    // owner's copied results were computed against.
    const catalogues = await ctx.db
      .query('placeCatalogues')
      .order('desc')
      .take(8);
    const catalogue = catalogues.find((row) => row.complete);
    if (!catalogue) throw new Error('No complete place catalogue');
    const run = await ctx.db.insert('shadowMatchRuns', {
      owner: owner._id,
      dataset: catalogue.dataset,
      after: '',
      done: false,
      matched: 0,
      skipped: 0,
      stale: 0,
      failed: [],
    });
    await ctx.scheduler.runAfter(0, internal.shadowMatchingWorker.run, { run });
    return run;
  },
});

/** Continue a run that stopped with an error or a lost action. */
export const resume = internalMutation({
  args: { run: v.id('shadowMatchRuns') },
  handler: async (ctx, { run }) => {
    const row = await ctx.db.get('shadowMatchRuns', run);
    if (!row) throw new Error('Run not found');
    await ctx.db.patch('shadowMatchRuns', run, { error: undefined });
    if (!row.done)
      await ctx.scheduler.runAfter(0, internal.shadowMatchingWorker.run, {
        run,
      });
    else if (!row.comparison?.done)
      await ctx.scheduler.runAfter(0, internal.shadowMatching.compareStep, {
        run,
      });
  },
});

/** The owner's runs, newest first. */
export const status = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const owner = await ownerFor(ctx, userId);
    if (!owner) return [];
    const runs = await ctx.db
      .query('shadowMatchRuns')
      .withIndex('by_owner', (q) => q.eq('owner', owner._id))
      .order('desc')
      .take(5);
    return runs.map(({ owner: _owner, ...run }) => run);
  },
});

/** What the worker needs for its next group, or null when the run is over. */
export const load = internalQuery({
  args: { run: v.id('shadowMatchRuns') },
  handler: async (ctx, { run }) => {
    const row = await ctx.db.get('shadowMatchRuns', run);
    if (!row || row.done || row.error) return null;
    const owner = await ctx.db.get('owners', row.owner);
    if (!owner || owner.revoked) return null;
    const catalogue = await ctx.db
      .query('placeCatalogues')
      .withIndex('by_dataset', (q) => q.eq('dataset', row.dataset))
      .unique();
    if (!catalogue?.complete) throw new Error('Catalogue rowset unavailable');
    const rows = await liveActivities(ctx, owner, row.after).take(READ_AHEAD);
    const items = await Promise.all(
      rows.map(async (activity) => {
        const recording =
          activity.recording &&
          (await ctx.db.get('recordings', activity.recording));
        return {
          key: activity.key,
          id: activity.dto?.id ?? null,
          recording: recording
            ? {
                id: recording._id,
                file: recording.file,
                manifest: recording.manifest,
                generation: recording.generation,
                revision: recording.revision,
              }
            : null,
        };
      }),
    );
    return {
      userId: owner.userId,
      matchingVersion: owner.matchingVersion,
      catalogue: {
        dataset: catalogue.dataset,
        snapshotId: catalogue.snapshotId,
        revision: catalogue.revision,
        metadata: catalogue.metadata,
      },
      items,
      exhausted: rows.length < READ_AHEAD,
    };
  },
});

/** Store a group's results and move the run past it. A result whose
 * recording is no longer the activity's current one is dropped. */
export const commit = internalMutation({
  args: {
    run: v.id('shadowMatchRuns'),
    after: v.string(),
    done: v.boolean(),
    skipped: v.number(),
    results: v.array(
      v.object({
        key: v.string(),
        recording: v.id('recordings'),
        result: placeMatchValidator,
      }),
    ),
    failed: v.array(v.object({ key: v.string(), reason: v.string() })),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get('shadowMatchRuns', args.run);
    // A repeated or late commit for a position already passed is a no-op.
    if (!row || row.done || args.after <= row.after) return false;
    let stale = 0;
    for (const item of args.results) {
      const activity = await activityFor(ctx, row.owner, item.key);
      if (
        !activity ||
        activity.deleted ||
        activity.recording !== item.recording
      ) {
        stale++;
        continue;
      }
      const existing = await ctx.db
        .query('shadowMatches')
        .withIndex('by_owner_activity', (q) =>
          q.eq('owner', row.owner).eq('activity', item.key),
        )
        .unique();
      const value = {
        owner: row.owner,
        activity: item.key,
        recording: item.recording,
        dataset: row.dataset,
        result: item.result,
      };
      if (existing) await ctx.db.replace('shadowMatches', existing._id, value);
      else await ctx.db.insert('shadowMatches', value);
    }
    await ctx.db.patch('shadowMatchRuns', args.run, {
      after: args.after,
      done: args.done,
      matched: row.matched + args.results.length - stale,
      skipped: row.skipped + args.skipped,
      stale: row.stale + stale,
      // Keep the record bounded; the count of failures matters most.
      failed: [...row.failed, ...args.failed].slice(0, 200),
    });
    await ctx.scheduler.runAfter(
      0,
      args.done
        ? internal.shadowMatching.compareStep
        : internal.shadowMatchingWorker.run,
      { run: args.run },
    );
    return true;
  },
});

/** Stop a run with the reason; `resume` continues it. */
export const fail = internalMutation({
  args: { run: v.id('shadowMatchRuns'), reason: v.string() },
  handler: async (ctx, { run, reason }) => {
    if (await ctx.db.get('shadowMatchRuns', run))
      await ctx.db.patch('shadowMatchRuns', run, {
        error: reason.slice(0, 300),
      });
  },
});

/** What a result says, without the per-backend revision token. */
function comparable(result: Doc<'shadowMatches'>['result']) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { resultRevision, ...rest } = result;
  return JSON.stringify(rest);
}
const describe = (result: Doc<'shadowMatches'>['result']) =>
  `${result.status}, ${result.places.length} places`;

/** Compare one page of the library and schedule the next. Only activities
 * whose copied result belongs to the owner's current catalogue and whose
 * shadow result was computed for their current recording are compared. */
export const compareStep = internalMutation({
  args: { run: v.id('shadowMatchRuns') },
  handler: async (ctx, { run }) => {
    const row = await ctx.db.get('shadowMatchRuns', run);
    if (!row?.done || row.comparison?.done) return;
    const owner = await ctx.db.get('owners', row.owner);
    if (!owner) return;
    const totals = row.comparison ?? {
      after: '',
      done: false,
      same: 0,
      different: 0,
      onlyPostgres: 0,
      onlyShadow: 0,
      neither: 0,
      examples: [],
    };
    const activities = await liveActivities(ctx, owner, totals.after).take(
      COMPARE_PAGE,
    );
    for (const activity of activities) {
      const copied =
        activity.projection?.match?.catalogue === owner.catalogue
          ? activity.projection.match.value
          : undefined;
      const stored = await ctx.db
        .query('shadowMatches')
        .withIndex('by_owner_activity', (q) =>
          q.eq('owner', owner._id).eq('activity', activity.key),
        )
        .unique();
      const shadow =
        stored &&
        stored.dataset === row.dataset &&
        stored.recording === activity.recording
          ? stored.result
          : undefined;
      if (copied && shadow) {
        if (comparable(copied) === comparable(shadow)) totals.same++;
        else {
          totals.different++;
          if (totals.examples.length < 20)
            totals.examples.push({
              key: activity.key,
              postgres: describe(copied),
              shadow: describe(shadow),
            });
        }
      } else if (copied) totals.onlyPostgres++;
      else if (shadow) totals.onlyShadow++;
      else totals.neither++;
    }
    const done = activities.length < COMPARE_PAGE;
    await ctx.db.patch('shadowMatchRuns', run, {
      comparison: {
        ...totals,
        after: done ? totals.after : activities.at(-1)!.key,
        done,
      },
    });
    if (!done)
      await ctx.scheduler.runAfter(0, internal.shadowMatching.compareStep, {
        run,
      });
  },
});
