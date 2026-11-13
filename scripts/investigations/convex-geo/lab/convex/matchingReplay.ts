import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  type MutationCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { locationHint } from './matching/validators';
import {
  manifestValidator,
  summaryValidator,
  uploadContentType,
} from './recording/validators';
import { beginUpload, eraseTarget, publishUpload } from './recordingRows';

const REPLAY_TTL_MS = 3 * 60 * 60_000;

async function armExpiry(ctx: MutationCtx, run: Id<'matchingRuns'>) {
  const state = await ctx.db.get('matchingRuns', run);
  if (
    !state ||
    state.fixtureAccount ||
    state.state === 'erasing' ||
    state.expiresAt !== undefined
  )
    return;
  const expiresAt = Date.now() + REPLAY_TTL_MS;
  await ctx.db.patch('matchingRuns', run, { expiresAt });
  await ctx.scheduler.runAt(expiresAt, internal.matchingReplay.expire, {
    run,
    expiresAt,
  });
}

export const arm = internalMutation({
  args: { run: v.id('matchingRuns') },
  handler: (ctx, { run }) => armExpiry(ctx, run),
});

// Explicit lab retention extension; the default abandoned-run expiry stays short.
export const retain = internalMutation({
  args: { run: v.id('matchingRuns'), hours: v.number() },
  handler: async (ctx, { run, hours }) => {
    const state = await ctx.db.get('matchingRuns', run);
    if (
      !state ||
      state.fixtureAccount ||
      !['loading', 'ready'].includes(state.state) ||
      !Number.isInteger(hours) ||
      hours < 1 ||
      hours > 168
    )
      throw new Error('Invalid replay retention extension');
    const expiresAt = Date.now() + hours * 60 * 60_000;
    await ctx.db.patch('matchingRuns', run, { expiresAt });
    await ctx.scheduler.runAt(expiresAt, internal.matchingReplay.expire, {
      run,
      expiresAt,
    });
    return { expiresAt };
  },
});

export const expire = internalMutation({
  args: { run: v.id('matchingRuns'), expiresAt: v.number() },
  handler: async (ctx, { run, expiresAt }) => {
    const state = await ctx.db.get('matchingRuns', run);
    if (
      !state ||
      state.fixtureAccount ||
      state.state === 'erasing' ||
      state.expiresAt !== expiresAt ||
      Date.now() < expiresAt
    )
      return;
    await ctx.db.patch('matchingRuns', run, { state: 'erasing' });
    await ctx.scheduler.runAfter(0, internal.matchingReplay.eraseBatch, {
      run,
    });
  },
});

export const create = internalMutation({
  args: {
    label: v.string(),
    generation: v.string(),
    expected: v.number(),
    manifestHash: v.string(),
    catalogue: v.id('matchingCatalogues'),
  },
  handler: async (ctx, args) => {
    if (
      !/^matching-[a-z0-9-]{1,60}$/.test(args.label) ||
      !/^[a-f0-9]{64}$/.test(args.manifestHash) ||
      !Number.isInteger(args.expected) ||
      args.expected < 1 ||
      args.expected > 5000 ||
      !(await ctx.db.get('matchingCatalogues', args.catalogue))
    )
      throw new Error('Invalid matching replay');
    const existing = await ctx.db
      .query('matchingRuns')
      .withIndex('label', (q) => q.eq('label', args.label))
      .unique();
    if (existing) {
      if (
        existing.manifestHash !== args.manifestHash ||
        existing.generation !== args.generation ||
        existing.catalogue !== args.catalogue ||
        existing.expected !== args.expected ||
        existing.state === 'erasing'
      )
        throw new Error('Replay label is in use');
      return existing._id;
    }
    const run = await ctx.db.insert('matchingRuns', {
      ...args,
      state: 'loading',
      imported: 0,
    });
    await armExpiry(ctx, run);
    return run;
  },
});

export const reserve = internalMutation({
  args: {
    run: v.id('matchingRuns'),
    records: v.array(
      v.object({
        index: v.number(),
        userId: v.string(),
        key: v.string(),
        sourceVersion: v.string(),
        generation: v.string(),
        originalRevision: v.string(),
        locationHint,
        manifest: manifestValidator,
        compressedHash: v.string(),
      }),
    ),
  },
  handler: async (ctx, { run: id, records }) => {
    const run = await ctx.db.get('matchingRuns', id);
    if (
      !run ||
      run.fixtureAccount ||
      run.state !== 'loading' ||
      records.length > 24
    )
      throw new Error('Replay is not accepting uploads');
    const reservations = [];
    for (const r of records) {
      if (
        !Number.isInteger(r.index) ||
        r.index < 0 ||
        r.index >= run.expected ||
        !/^[1-9][0-9]{0,19}$/.test(r.key) ||
        !/^\d+$/.test(r.originalRevision) ||
        !/^(postgres-v1:[a-f0-9]{32}|synthetic-v1:[a-z0-9-]+)$/.test(
          r.sourceVersion,
        )
      )
        throw new Error('Invalid replay recording identity');
      let owner = await ctx.db
        .query('matchingOwners')
        .withIndex('run_user', (q) => q.eq('run', id).eq('userId', r.userId))
        .unique();
      if (!owner) {
        const ownerId = await ctx.db.insert('matchingOwners', {
          run: id,
          userId: r.userId,
          generation: run.generation,
          sequence: 0,
        });
        owner = (await ctx.db.get('matchingOwners', ownerId))!;
      }
      const existing = await ctx.db
        .query('matchingItems')
        .withIndex('run_index', (q) => q.eq('run', id).eq('index', r.index))
        .unique();
      let item = existing?._id;
      let target = existing
        ? await ctx.db.get('recordingTargets', existing.target)
        : null;
      if (!existing) {
        const duplicate = await ctx.db
          .query('recordingTargets')
          .withIndex('owner_key', (q) =>
            q.eq('owner', owner._id).eq('key', r.key),
          )
          .unique();
        if (duplicate) throw new Error('Duplicate owner activity in replay');
        const targetId = await ctx.db.insert('recordingTargets', {
          owner: owner._id,
          key: r.key,
          generation: r.generation,
          sourceVersion: r.sourceVersion,
          accountGeneration: run.generation,
        });
        item = await ctx.db.insert('matchingItems', {
          run: id,
          index: r.index,
          owner: owner._id,
          target: targetId,
          originalRevision: r.originalRevision,
          locationHint: r.locationHint,
          samples: r.manifest.counts.latlng ?? 0,
          phase: 'loading',
        });
        target = await ctx.db.get('recordingTargets', targetId);
      }
      if (
        !item ||
        !target ||
        target.owner !== owner._id ||
        target.key !== r.key ||
        target.sourceVersion !== r.sourceVersion ||
        target.generation !== r.generation ||
        (existing && existing.originalRevision !== r.originalRevision)
      )
        throw new Error('Replay reservation identity changed');
      if (target.current) {
        const stored = await ctx.db.get('recordingManifests', target.current);
        if (stored?.manifest.contentHash !== r.manifest.contentHash)
          throw new Error('Published replay recording content differs');
        continue;
      }
      const attempt = await beginUpload(
        ctx,
        target._id,
        r.manifest,
        r.compressedHash,
        65 * 60_000,
      );
      reservations.push({
        index: r.index,
        item,
        attempt,
        contentType: uploadContentType(attempt),
        url: await ctx.storage.generateUploadUrl(),
      });
    }
    return reservations;
  },
});

export const publish = internalMutation({
  args: {
    run: v.id('matchingRuns'),
    uploads: v.array(
      v.object({
        item: v.id('matchingItems'),
        attempt: v.id('recordingAttempts'),
        file: v.id('_storage'),
        summary: summaryValidator,
      }),
    ),
  },
  handler: async (ctx, { run: id, uploads }) => {
    const run = await ctx.db.get('matchingRuns', id);
    if (
      !run ||
      run.fixtureAccount ||
      run.state !== 'loading' ||
      uploads.length > 24
    )
      throw new Error('Replay is not accepting publications');
    let added = 0;
    for (const { item: itemId, attempt, file, summary } of uploads) {
      const item = await ctx.db.get('matchingItems', itemId);
      if (!item || item.run !== id)
        throw new Error('Replay item scope differs');
      if (item.phase !== 'loading') {
        const target = await ctx.db.get('recordingTargets', item.target);
        const current = target?.current
          ? await ctx.db.get('recordingManifests', target.current)
          : null;
        if (current?.file === file) continue;
        throw new Error('Replay item already published');
      }
      const upload = await ctx.db.get('recordingAttempts', attempt);
      if (
        !upload ||
        upload.target !== item.target ||
        (await publishUpload(ctx, attempt, file, summary)) === null
      )
        throw new Error('Replay recording publication fenced');
      await ctx.db.patch('matchingItems', itemId, { phase: 'pending' });
      added++;
    }
    await ctx.db.patch('matchingRuns', id, { imported: run.imported + added });
    return added;
  },
});

export const ready = internalMutation({
  args: { run: v.id('matchingRuns') },
  handler: async (ctx, { run: id }) => {
    const run = await ctx.db.get('matchingRuns', id);
    if (
      !run ||
      run.fixtureAccount ||
      run.imported !== run.expected ||
      (run.state !== 'loading' && run.state !== 'ready')
    )
      throw new Error('Replay import incomplete');
    if (run.state === 'ready') return;
    await ctx.db.patch('matchingRuns', id, { state: 'ready' });
  },
});

export const state = internalQuery({
  args: { run: v.id('matchingRuns') },
  handler: (ctx, { run }) => ctx.db.get('matchingRuns', run),
});

export const erase = internalMutation({
  args: { run: v.id('matchingRuns') },
  handler: async (ctx, { run }) => {
    const state = await ctx.db.get('matchingRuns', run);
    if (!state || state.state === 'erasing') return;
    await ctx.db.patch('matchingRuns', run, { state: 'erasing' });
    await ctx.scheduler.runAfter(0, internal.matchingReplay.eraseBatch, {
      run,
    });
  },
});

export const eraseBatch = internalMutation({
  args: { run: v.id('matchingRuns') },
  handler: async (ctx, { run }) => {
    const state = await ctx.db.get('matchingRuns', run);
    if (state?.state !== 'erasing') return;
    const items = await ctx.db
      .query('matchingItems')
      .withIndex('run_index', (q) => q.eq('run', run))
      .take(80);
    const groups = await ctx.db
      .query('matchingGroups')
      .withIndex('run_mode_ordinal', (q) => q.eq('run', run))
      .take(25);
    const owners = await ctx.db
      .query('matchingOwners')
      .withIndex('run_user', (q) => q.eq('run', run))
      .take(8);
    for (const item of items) {
      const check = await ctx.db
        .query('placeChecks')
        .withIndex('target', (q) => q.eq('target', item.target))
        .unique();
      if (check) await ctx.db.delete('placeChecks', check._id);
      const target = await ctx.db.get('recordingTargets', item.target);
      if (target && !state.fixtureAccount) {
        // A late writer may still use a previously issued upload URL. Its
        // registered attempt remains until the normal orphan deadline.
        if (target.current || !target.latestAttempt)
          await eraseTarget(ctx, target);
        else await ctx.db.delete('recordingTargets', target._id);
      }
      await ctx.db.delete('matchingItems', item._id);
    }
    for (const group of groups)
      await ctx.db.delete('matchingGroups', group._id);
    if (!items.length) {
      for (const owner of owners) {
        const changes = await ctx.db
          .query('matchingChanges')
          .withIndex('owner_sequence', (q) => q.eq('owner', owner._id))
          .take(80);
        for (const change of changes)
          await ctx.db.delete('matchingChanges', change._id);
        if (!changes.length) await ctx.db.delete('matchingOwners', owner._id);
      }
    }
    if (items.length || groups.length || owners.length)
      await ctx.scheduler.runAfter(0, internal.matchingReplay.eraseBatch, {
        run,
      });
    else await ctx.db.delete('matchingRuns', run);
  },
});

export const files = internalQuery({
  args: { run: v.id('matchingRuns'), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { run, cursor }) => {
    const state = await ctx.db.get('matchingRuns', run);
    if (!state || state.state !== 'ready' || state.fixtureAccount)
      throw new Error('Replay is not ready for a file audit');
    const page = await ctx.db
      .query('matchingItems')
      .withIndex('run_index', (q) => q.eq('run', run))
      .paginate({ cursor, numItems: 128 });
    const entries = await Promise.all(
      page.page.map(async (item) => {
        const target = await ctx.db.get('recordingTargets', item.target);
        const recording = target?.current
          ? await ctx.db.get('recordingManifests', target.current)
          : null;
        if (!target || !recording)
          throw new Error('Replay recording missing during audit');
        const check = await ctx.db
          .query('placeChecks')
          .withIndex('target', (q) => q.eq('target', target._id))
          .unique();
        if (!check) return { file: recording.file, check: null };
        const change = await ctx.db
          .query('matchingChanges')
          .withIndex('owner_sequence', (q) =>
            q.eq('owner', item.owner).eq('sequence', check.sequence),
          )
          .unique();
        if (
          !change ||
          change.key !== target.key ||
          check.recording !== recording._id ||
          check.catalogue !== state.catalogue ||
          check.owner !== item.owner
        )
          throw new Error('Replay change or recording scope differs');
        return {
          file: recording.file,
          check: {
            index: item.index,
            recordingRevision: recording.revision,
            result: check.result,
            sequence: check.sequence,
          },
        };
      }),
    );
    return {
      files: entries.map(({ file }) => file),
      checks: entries.flatMap(({ check }) => (check ? [check] : [])),
      done: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const filesRemaining = internalQuery({
  args: { files: v.array(v.id('_storage')) },
  handler: async (ctx, { files }) => {
    if (files.length > 128) throw new Error('File audit page limit');
    return (
      await Promise.all(
        files.map((file) => ctx.db.system.get('_storage', file)),
      )
    ).filter((file) => file !== null).length;
  },
});

export const ownerSequences = internalQuery({
  args: { run: v.id('matchingRuns') },
  handler: async (ctx, { run }) => {
    const state = await ctx.db.get('matchingRuns', run);
    if (!state || state.state !== 'ready' || state.fixtureAccount)
      throw new Error('Replay scope is unavailable');
    const owners = await ctx.db
      .query('matchingOwners')
      .withIndex('run_user', (q) => q.eq('run', run))
      .collect();
    return Promise.all(
      owners.map(async (owner) => {
        const first = await ctx.db
          .query('matchingChanges')
          .withIndex('owner_sequence', (q) => q.eq('owner', owner._id))
          .first();
        const last = await ctx.db
          .query('matchingChanges')
          .withIndex('owner_sequence', (q) => q.eq('owner', owner._id))
          .order('desc')
          .first();
        return {
          first: first?.sequence ?? 0,
          last: last?.sequence ?? 0,
          head: owner.sequence,
        };
      }),
    );
  },
});

// Reset only derived benchmark state. Uploaded recordings remain immutable;
// the run state fences any already scheduled workers before deletion begins.
export const reset = internalMutation({
  args: { run: v.id('matchingRuns') },
  handler: async (ctx, { run }) => {
    const state = await ctx.db.get('matchingRuns', run);
    if (!state || state.fixtureAccount || state.state !== 'ready')
      throw new Error('Replay is not resettable');
    await ctx.db.patch('matchingRuns', run, { state: 'resetting' });
    await ctx.scheduler.runAfter(0, internal.matchingReplay.resetBatch, {
      run,
      cursor: null,
    });
  },
});

export const resetBatch = internalMutation({
  args: { run: v.id('matchingRuns'), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { run, cursor }) => {
    if ((await ctx.db.get('matchingRuns', run))?.state !== 'resetting') return;
    const page = await ctx.db
      .query('matchingItems')
      .withIndex('run_index', (q) => q.eq('run', run))
      .paginate({ cursor, numItems: 100 });
    for (const item of page.page) {
      const check = await ctx.db
        .query('placeChecks')
        .withIndex('target', (q) => q.eq('target', item.target))
        .unique();
      if (check) {
        const change = await ctx.db
          .query('matchingChanges')
          .withIndex('owner_sequence', (q) =>
            q.eq('owner', check.owner).eq('sequence', check.sequence),
          )
          .unique();
        if (change) await ctx.db.delete('matchingChanges', change._id);
        await ctx.db.delete('placeChecks', check._id);
      }
      if (item.phase === 'actual')
        await ctx.db.patch('matchingItems', item._id, { phase: 'pending' });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.matchingReplay.resetBatch, {
        run,
        cursor: page.continueCursor,
      });
      return;
    }
    const groups = await ctx.db
      .query('matchingGroups')
      .withIndex('run_mode_ordinal', (q) => q.eq('run', run))
      .take(25);
    for (const group of groups)
      await ctx.db.delete('matchingGroups', group._id);
    if (groups.length === 25) {
      await ctx.scheduler.runAfter(
        0,
        internal.matchingReplay.clearGroupCheckpoints,
        { run },
      );
      return;
    }
    await finishReset(ctx, run);
  },
});

async function finishReset(ctx: MutationCtx, run: Id<'matchingRuns'>) {
  const owners = await ctx.db
    .query('matchingOwners')
    .withIndex('run_user', (q) => q.eq('run', run))
    .collect();
  for (const owner of owners) {
    const residual = await ctx.db
      .query('matchingChanges')
      .withIndex('owner_sequence', (q) => q.eq('owner', owner._id))
      .first();
    if (residual) throw new Error('Residual changes block replay reset');
    await ctx.db.patch('matchingOwners', owner._id, { sequence: 0 });
  }
  await ctx.db.patch('matchingRuns', run, {
    state: 'ready',
    actualPoolEnd: undefined,
    actualSelected: undefined,
  });
}

export const clearGroupCheckpoints = internalMutation({
  args: { run: v.id('matchingRuns') },
  handler: async (ctx, { run }) => {
    if ((await ctx.db.get('matchingRuns', run))?.state !== 'resetting') return;
    const groups = await ctx.db
      .query('matchingGroups')
      .withIndex('run_mode_ordinal', (q) => q.eq('run', run))
      .take(25);
    for (const group of groups)
      await ctx.db.delete('matchingGroups', group._id);
    if (groups.length === 25)
      await ctx.scheduler.runAfter(
        0,
        internal.matchingReplay.clearGroupCheckpoints,
        { run },
      );
    else await finishReset(ctx, run);
  },
});
