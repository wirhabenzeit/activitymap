import { type Infer, v } from 'convex/values';

import {
  PLACE_MATCHING_BATCH_SIZE,
  PLACE_MATCHING_CANDIDATE_MULTIPLIER,
} from '../../../../../src/server/places/matching-batch-limits';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  catalogueIdentity,
  claimFields,
  metrics,
  mode,
  rectangle,
  response,
} from './matching/validators';
import { publishFixturePreviewMatch } from './previewRows';

const MAX_ATTEMPTS = 3;
const lease = 90_000;
const claimValidator = v.object(claimFields);
type Claim = Infer<typeof claimValidator>;

async function held(ctx: QueryCtx | MutationCtx, { group, attempt }: Claim) {
  const row = await ctx.db.get('matchingGroups', group);
  if (
    !row ||
    row.state !== 'pending' ||
    row.attempt !== attempt ||
    Date.now() >= row.leaseUntil
  )
    return null;
  const run = await ctx.db.get('matchingRuns', row.run);
  if (!run || run.state !== 'ready') return null;
  const catalogue = await ctx.db.get('matchingCatalogues', run.catalogue);
  if (!catalogue) return null;
  if (run.fixtureAccount) {
    const account = await ctx.db.get('ingestionAccounts', run.fixtureAccount);
    if (
      account?.state !== 'active' ||
      String(account.generation) !== run.generation ||
      account.matchingCatalogue !== run.catalogue
    )
      return null;
  }
  return { row, run, catalogue };
}

export async function dispatch(
  ctx: MutationCtx,
  group: Id<'matchingGroups'>,
  attempt: number,
  delay = 0,
  leaseMs = lease,
) {
  const worker = await ctx.scheduler.runAfter(
    delay,
    internal.matchingWorker.run,
    { group, attempt },
  );
  await ctx.db.patch('matchingGroups', group, {
    attempt,
    worker,
    leaseUntil: Date.now() + delay + leaseMs,
  });
  await ctx.scheduler.runAfter(
    delay + leaseMs,
    internal.matchingGroups.recover,
    { group, attempt },
  );
}

export const start = internalMutation({
  args: {
    run: v.id('matchingRuns'),
    mode,
    ordinal: v.number(),
    items: v.optional(v.array(v.number())),
    parallelism: v.optional(v.union(v.literal(1), v.literal(4))),
    interruptFirstAttempt: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { parallelism = 1, interruptFirstAttempt = false, ...args },
  ) => {
    const run = await ctx.db.get('matchingRuns', args.run);
    if (
      !run ||
      run.state !== 'ready' ||
      !Number.isInteger(args.ordinal) ||
      args.ordinal < 0 ||
      (args.mode === 'actual'
        ? args.items !== undefined
        : !args.items?.length ||
          args.items.length > 500 ||
          new Set(args.items).size !== args.items.length) ||
      (args.mode === 'single' && args.items?.length !== 1) ||
      (parallelism === 4 && args.mode !== 'parallel') ||
      (interruptFirstAttempt && (run.expected !== 1 || args.mode !== 'single'))
    )
      throw new Error('Invalid matching group');
    const existing = await ctx.db
      .query('matchingGroups')
      .withIndex('run_mode_ordinal', (q) =>
        q.eq('run', args.run).eq('mode', args.mode).eq('ordinal', args.ordinal),
      )
      .unique();
    if (existing) {
      if (
        existing.parallelism !== parallelism ||
        JSON.stringify(existing.items) !== JSON.stringify(args.items)
      )
        throw new Error('Matching group identity differs');
      return existing._id;
    }
    const prior = await ctx.db
      .query('matchingGroups')
      .withIndex('run_mode_ordinal', (q) =>
        q.eq('run', args.run).eq('mode', args.mode),
      )
      .order('desc')
      .first();
    if (
      prior
        ? prior.state !== 'complete' || prior.ordinal + 1 !== args.ordinal
        : args.ordinal !== 0
    )
      throw new Error('Previous matching checkpoint is incomplete');
    if (
      args.mode === 'actual' &&
      (run.actualPoolEnd === undefined ||
        run.actualSelected === PLACE_MATCHING_BATCH_SIZE ||
        !(await ctx.db
          .query('matchingItems')
          .withIndex('run_phase_index', (q) =>
            q
              .eq('run', run._id)
              .eq('phase', 'pending')
              .lte('index', run.actualPoolEnd!),
          )
          .first()))
    ) {
      const pool = await ctx.db
        .query('matchingItems')
        .withIndex('run_phase_index', (q) =>
          q.eq('run', run._id).eq('phase', 'pending'),
        )
        .take(PLACE_MATCHING_BATCH_SIZE * PLACE_MATCHING_CANDIDATE_MULTIPLIER);
      await ctx.db.patch('matchingRuns', run._id, {
        actualPoolEnd: pool.at(-1)?.index ?? -1,
        actualSelected: 0,
      });
    }
    const group = await ctx.db.insert('matchingGroups', {
      ...args,
      parallelism,
      interruptFirstAttempt,
      state: 'pending',
      attempt: 1,
      leaseUntil: 0,
    });
    await dispatch(ctx, group, 1, 0, interruptFirstAttempt ? 6_000 : lease);
    return group;
  },
});

export const recover = internalMutation({
  args: claimFields,
  handler: async (ctx, { group, attempt }) => {
    const row = await ctx.db.get('matchingGroups', group);
    if (
      !row ||
      row.state !== 'pending' ||
      row.attempt !== attempt ||
      row.leaseUntil > Date.now() ||
      (await ctx.db.get('matchingRuns', row.run))?.state !== 'ready'
    )
      return;
    if (attempt >= MAX_ATTEMPTS)
      await ctx.db.patch('matchingGroups', group, {
        state: 'failed',
        failure: 'lease_exhausted',
      });
    else await dispatch(ctx, group, attempt + 1, 0, lease);
  },
});

export const fail = internalMutation({
  args: { ...claimFields, reason: v.string() },
  handler: async (ctx, { reason, ...claim }) => {
    const current = await held(ctx, claim);
    if (!current) return;
    await ctx.db.patch('matchingGroups', claim.group, {
      state: 'failed',
      failure: reason.slice(0, 60),
    });
  },
});

async function readRecording(
  ctx: QueryCtx | MutationCtx,
  run: Doc<'matchingRuns'>,
  item: Doc<'matchingItems'>,
) {
  if (item.run !== run._id || item.phase === 'loading') return null;
  const owner = await ctx.db.get('matchingOwners', item.owner);
  const target = await ctx.db.get('recordingTargets', item.target);
  if (
    !owner ||
    owner.run !== run._id ||
    owner.generation !== run.generation ||
    !target?.current ||
    target.owner !== (run.fixtureAccount ?? owner._id) ||
    target.accountGeneration !== owner.generation
  )
    return null;
  if (run.fixtureAccount) {
    if (!item.fixtureJob || target.current !== item.fixtureRecording)
      return null;
    const job = await ctx.db.get('ingestionJobs', item.fixtureJob);
    const account = await ctx.db.get('ingestionAccounts', run.fixtureAccount);
    if (
      account?.state !== 'active' ||
      account.matchingCatalogue !== run.catalogue ||
      String(account.generation) !== run.generation ||
      !job ||
      job.account !== account._id ||
      job.deleted ||
      job.target !== target._id ||
      job.key !== target.key ||
      job.version !== item.fixtureVersion ||
      job.committedVersion !== item.fixtureVersion ||
      job.generation !== account.generation ||
      target.sourceVersion !== `fixture-v1:${job.version}`
    )
      return null;
  }
  const recording = await ctx.db.get('recordingManifests', target.current);
  if (
    !recording ||
    recording.owner !== target.owner ||
    recording.key !== target.key ||
    recording.accountGeneration !== owner.generation ||
    recording.sourceVersion !== target.sourceVersion ||
    recording.generation !== target.generation
  )
    return null;
  return { owner, target, recording };
}

export const load = internalQuery({
  args: claimFields,
  handler: async (ctx, claim) => {
    const current = await held(ctx, claim);
    if (!current) return null;
    const { row, catalogue, run } = current;
    const items = row.items
      ? await Promise.all(
          row.items.map((index) =>
            ctx.db
              .query('matchingItems')
              .withIndex('run_index', (q) =>
                q.eq('run', row.run).eq('index', index),
              )
              .unique(),
          ),
        )
      : await ctx.db
          .query('matchingItems')
          .withIndex('run_phase_index', (q) =>
            q
              .eq('run', row.run)
              .eq('phase', 'pending')
              .lte('index', run.actualPoolEnd ?? -1),
          )
          .take(
            PLACE_MATCHING_BATCH_SIZE * PLACE_MATCHING_CANDIDATE_MULTIPLIER,
          );
    if (items.some((item) => !item || item.phase === 'loading'))
      throw new Error('Matching group has an unavailable item');
    return {
      row,
      catalogue,
      items: items.filter((item) => item !== null),
      remaining: PLACE_MATCHING_BATCH_SIZE - (run.actualSelected ?? 0),
    };
  },
});

export const inputs = internalQuery({
  args: { ...claimFields, items: v.array(v.id('matchingItems')) },
  handler: async (ctx, { items, ...claim }) => {
    const current = await held(ctx, claim);
    if (!current || items.length > 500) return null;
    return Promise.all(
      items.map(async (id) => {
        const item = await ctx.db.get('matchingItems', id);
        return item ? readRecording(ctx, current.run, item) : null;
      }),
    );
  },
});

export const status = internalQuery({
  args: { group: v.id('matchingGroups') },
  handler: (ctx, { group }) => ctx.db.get('matchingGroups', group),
});

export const check = internalQuery({
  args: { run: v.id('matchingRuns'), index: v.number() },
  handler: async (ctx, { run: id, index }) => {
    const run = await ctx.db.get('matchingRuns', id);
    if (!run || run.state !== 'ready') return null;
    const item = await ctx.db
      .query('matchingItems')
      .withIndex('run_index', (q) => q.eq('run', id).eq('index', index))
      .unique();
    if (!item) return null;
    const scope = await readRecording(ctx, run, item);
    if (!scope) return null;
    const check = await ctx.db
      .query('placeChecks')
      .withIndex('target', (q) => q.eq('target', item.target))
      .unique();
    if (
      !check ||
      check.owner !== item.owner ||
      check.recording !== scope.recording._id ||
      check.catalogue !== run.catalogue
    )
      return null;
    const change = await ctx.db
      .query('matchingChanges')
      .withIndex('owner_sequence', (q) =>
        q.eq('owner', item.owner).eq('sequence', check.sequence),
      )
      .unique();
    return { check, change };
  },
});

export const commit = internalMutation({
  args: {
    ...claimFields,
    ...catalogueIdentity,
    windows: v.array(rectangle),
    candidateHash: v.string(),
    metrics,
    writes: v.array(
      v.object({
        item: v.id('matchingItems'),
        recording: v.id('recordingManifests'),
        sourceVersion: v.string(),
        hash: v.string(),
        result: response,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const current = await held(ctx, args);
    if (!current) return false;
    const { row, run, catalogue } = current;
    if (
      args.snapshotId !== catalogue.snapshotId ||
      args.recipe !== catalogue.recipe ||
      args.revision !== catalogue.revision ||
      args.writes.length > 500 ||
      args.windows.length > 2000 ||
      new Set(args.writes.map((w) => w.item)).size !== args.writes.length ||
      (row.items && args.writes.length !== row.items.length) ||
      (row.mode === 'actual' &&
        (run.actualSelected ?? 0) + args.writes.length >
          PLACE_MATCHING_BATCH_SIZE) ||
      (!row.items &&
        !args.writes.length &&
        (await ctx.db
          .query('matchingItems')
          .withIndex('run_phase_index', (q) =>
            q.eq('run', run._id).eq('phase', 'pending'),
          )
          .first()))
    )
      return false;
    // Read all fences before making changes. Transactional revalidation covers
    // erasure, account generation, source, file replacement and recipe.
    const scopes = [];
    for (const write of args.writes) {
      const item = await ctx.db.get('matchingItems', write.item);
      const scope = item ? await readRecording(ctx, run, item) : null;
      if (
        !item ||
        !scope ||
        (row.items && !row.items.includes(item.index)) ||
        (row.mode === 'actual' &&
          (item.phase !== 'pending' ||
            item.index > (run.actualPoolEnd ?? -1))) ||
        scope.recording._id !== write.recording ||
        scope.recording.sourceVersion !== write.sourceVersion ||
        write.result.userId !== scope.owner.userId ||
        write.result.activityId !== scope.recording.key ||
        write.result.streamGeneration !== scope.recording.generation ||
        write.result.streamRevision !== String(scope.recording.revision) ||
        write.result.catalogueSnapshotId !== catalogue.snapshotId
      )
        return false;
      scopes.push({ item, scope, write });
    }
    const matches = [];
    for (const { item, scope, write } of scopes) {
      const { owner, recording, target } = scope;
      const prior = await ctx.db
        .query('placeChecks')
        .withIndex('target', (q) => q.eq('target', target._id))
        .unique();
      if (
        prior?.recording !== recording._id ||
        prior.catalogue !== catalogue._id ||
        prior.recipe !== catalogue.recipe
      ) {
        // Re-read the owner head to include prior writes in this transaction.
        const head = await ctx.db.get('matchingOwners', owner._id);
        const sequence = head!.sequence + 1;
        await ctx.db.patch('matchingOwners', owner._id, { sequence });
        const check = {
          owner: owner._id,
          target: target._id,
          catalogue: catalogue._id,
          snapshotId: catalogue.snapshotId,
          revision: catalogue.revision,
          recipe: catalogue.recipe,
          accountGeneration: owner.generation,
          sourceVersion: recording.sourceVersion,
          recording: recording._id,
          recordingGeneration: recording.generation,
          recordingRevision: recording.revision,
          result: write.result,
          sequence,
        };
        if (prior) await ctx.db.replace('placeChecks', prior._id, check);
        else await ctx.db.insert('placeChecks', check);
        if (run.fixtureAccount)
          await publishFixturePreviewMatch(ctx, target._id);
        await ctx.db.insert('matchingChanges', {
          owner: owner._id,
          sequence,
          key: target.key,
          operation: 'upsert',
        });
      }
      if (row.mode === 'actual')
        await ctx.db.patch('matchingItems', item._id, { phase: 'actual' });
      matches.push({
        index: item.index,
        hash: write.hash,
        status: write.result.status,
      });
    }
    if (row.mode === 'actual') {
      await ctx.db.patch('matchingRuns', run._id, {
        actualSelected: (run.actualSelected ?? 0) + args.writes.length,
      });
    }
    await ctx.db.patch('matchingGroups', row._id, {
      state: 'complete',
      windows: args.windows,
      candidateHash: args.candidateHash,
      matches,
      metrics: args.metrics,
    });
    return true;
  },
});
