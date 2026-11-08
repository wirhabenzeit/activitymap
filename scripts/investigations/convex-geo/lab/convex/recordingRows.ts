import { type Infer, v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  manifestValidator,
  scopeFields,
  summaryValidator,
  uploadContentType,
} from './recording/validators';

// Beyond the ten-minute Node action deadline. Once expired the original
// writer can no longer create a late file or win publication.
const ATTEMPT_MS = 15 * 60_000;
const scopeValidator = v.object(scopeFields);
type Scope = Infer<typeof scopeValidator>;

async function targetFor(ctx: QueryCtx | MutationCtx, scope: Scope) {
  const target = await ctx.db
    .query('recordingTargets')
    .withIndex('owner_key', (q) =>
      q.eq('owner', scope.owner).eq('key', scope.key),
    )
    .unique();
  if (
    target &&
    (target.generation !== scope.generation ||
      target.accountGeneration !== scope.accountGeneration ||
      target.sourceVersion !== scope.sourceVersion)
  )
    throw new Error('Recording target scope changed');
  return target;
}

async function removeRevision(
  ctx: MutationCtx,
  revision: Doc<'recordingManifests'>,
) {
  await ctx.storage.delete(revision.file);
  await ctx.db.delete('recordingSummaries', revision.summary);
  await ctx.db.delete('recordingManifests', revision._id);
}

export const provision = internalMutation({
  args: scopeFields,
  handler: async (ctx, scope) => {
    const target = await targetFor(ctx, scope);
    return target?._id ?? (await ctx.db.insert('recordingTargets', scope));
  },
});

export async function beginUpload(
  ctx: MutationCtx,
  target: Id<'recordingTargets'>,
  manifest: Infer<typeof manifestValidator>,
  compressedHash: string,
  attemptMs = ATTEMPT_MS,
) {
  const attempt = await ctx.db.insert('recordingAttempts', {
    target,
    manifest,
    compressedHash,
    expiresAt: Date.now() + attemptMs,
  });
  await ctx.db.patch('recordingTargets', target, {
    latestAttempt: attempt,
  });
  await ctx.scheduler.runAfter(attemptMs, internal.recordingRows.reap, {
    attempt,
    cursor: null,
  });
  return attempt;
}

export const begin = internalMutation({
  args: {
    scope: scopeValidator,
    manifest: manifestValidator,
    compressedHash: v.string(),
  },
  handler: async (ctx, { scope, manifest, compressedHash }) => {
    const target = await targetFor(ctx, scope);
    if (!target) throw new Error('Missing recording target');
    return beginUpload(ctx, target._id, manifest, compressedHash);
  },
});

export async function publishUpload(
  ctx: MutationCtx,
  attempt: Id<'recordingAttempts'>,
  file: Id<'_storage'>,
  summary: Infer<typeof summaryValidator>,
) {
  const upload = await ctx.db.get('recordingAttempts', attempt);
  if (!upload || upload.expiresAt <= Date.now()) return null;
  const target = await ctx.db.get('recordingTargets', upload.target);
  if (!target || target.latestAttempt !== attempt) return null;
  const stored = await ctx.db.system.get('_storage', file);
  if (
    !stored ||
    stored.contentType !== uploadContentType(attempt) ||
    stored.size !== upload.manifest.compressedBytes ||
    stored.sha256 !== upload.compressedHash
  )
    throw new Error('Uploaded recording metadata mismatch');

  const prior = target.current
    ? await ctx.db.get('recordingManifests', target.current)
    : null;
  const revision = (prior?.revision ?? 0) + 1;
  const summaryId = await ctx.db.insert('recordingSummaries', { summary });
  const { owner, key, accountGeneration, sourceVersion, generation } = target;
  const id = await ctx.db.insert('recordingManifests', {
    owner,
    key,
    accountGeneration,
    sourceVersion,
    generation,
    revision,
    file,
    summary: summaryId,
    manifest: upload.manifest,
  });
  await ctx.db.patch('recordingTargets', target._id, {
    current: id,
    latestAttempt: undefined,
  });
  if (prior) await removeRevision(ctx, prior);
  await ctx.db.delete('recordingAttempts', attempt);
  return revision;
}

export const publish = internalMutation({
  args: {
    attempt: v.id('recordingAttempts'),
    file: v.id('_storage'),
    summary: summaryValidator,
  },
  handler: (ctx, { attempt, file, summary }) =>
    publishUpload(ctx, attempt, file, summary),
});

export async function readCurrent(
  ctx: QueryCtx,
  target: Doc<'recordingTargets'>,
) {
  if (!target.current) return null;
  const manifest = await ctx.db.get('recordingManifests', target.current);
  if (!manifest) throw new Error('Missing published recording manifest');
  if (
    manifest.sourceVersion !== target.sourceVersion ||
    manifest.accountGeneration !== target.accountGeneration ||
    manifest.generation !== target.generation
  )
    return null;
  const summary = await ctx.db.get('recordingSummaries', manifest.summary);
  if (!summary) throw new Error('Missing published recording summary');
  return { manifest, summary: summary.summary };
}

export async function eraseTarget(
  ctx: MutationCtx,
  target: Doc<'recordingTargets'>,
) {
  const prior = target.current
    ? await ctx.db.get('recordingManifests', target.current)
    : null;
  if (prior) await removeRevision(ctx, prior);
  await ctx.db.delete('recordingTargets', target._id);
}

export const current = internalQuery({
  args: scopeFields,
  handler: async (ctx, scope) => {
    const target = await targetFor(ctx, scope);
    return target ? readCurrent(ctx, target) : null;
  },
});

export const erase = internalMutation({
  args: scopeFields,
  handler: async (ctx, scope) => {
    const target = await targetFor(ctx, scope);
    if (!target) return false;
    await eraseTarget(ctx, target);
    return true;
  },
});

// A terminal scheduled writer cannot create a new file.
export async function retireUpload(
  ctx: MutationCtx,
  attempt: Id<'recordingAttempts'>,
) {
  const upload = await ctx.db.get('recordingAttempts', attempt);
  if (!upload || upload.expiresAt <= Date.now()) return;
  await ctx.db.patch('recordingAttempts', attempt, { expiresAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.recordingRows.reap, {
    attempt,
    cursor: null,
  });
}

// A writer that has already stopped uploading can close its attempt early.
export const close = internalMutation({
  args: { attempt: v.id('recordingAttempts') },
  handler: async (ctx, { attempt }) => {
    const upload = await ctx.db.get('recordingAttempts', attempt);
    if (upload && upload.expiresAt > Date.now())
      await ctx.db.patch('recordingAttempts', attempt, {
        expiresAt: Date.now(),
      });
  },
});

export const reap = internalMutation({
  args: {
    attempt: v.id('recordingAttempts'),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { attempt, cursor }): Promise<number> => {
    const upload = await ctx.db.get('recordingAttempts', attempt);
    // Successful publication deletes the attempt atomically with its new pointer.
    if (!upload || upload.expiresAt > Date.now()) return 0;
    const page = await ctx.db.system
      .query('_storage')
      .withIndex('by_creation_time', (q) =>
        q
          .gte('_creationTime', upload._creationTime)
          .lte('_creationTime', upload.expiresAt),
      )
      .paginate({ cursor, numItems: 64 });
    let removed = 0;
    for (const file of page.page) {
      // Only this attempt's server-side writer knows the unique marker.
      // Reclaim its files even if publication rejected their size or checksum.
      if (file.contentType === uploadContentType(attempt)) {
        await ctx.storage.delete(file._id);
        removed++;
      }
    }
    if (page.isDone) {
      const target = await ctx.db.get('recordingTargets', upload.target);
      if (target?.latestAttempt === attempt)
        await ctx.db.patch('recordingTargets', target._id, {
          latestAttempt: undefined,
        });
      await ctx.db.delete('recordingAttempts', attempt);
    } else {
      await ctx.scheduler.runAfter(0, internal.recordingRows.reap, {
        attempt,
        cursor: page.continueCursor,
      });
    }
    return removed;
  },
});
