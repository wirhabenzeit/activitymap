import { v } from 'convex/values';

import { activityDTOSchema } from '~/contracts/v1/activity';
import { photoDTOSchema } from '~/contracts/v1/photo';

import {
  MAX_PAGE_BYTES,
  PROJECTION_VERSION,
  jsonBytes as bytes,
} from '../../../../../backend/convex/activityProjection';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  type ProjectionSource,
  metadata,
  projectActivity,
  projectionSource,
  streamState,
} from './previewProjection';
import {
  activityFor,
  deletePreviewActivity,
  deletePreviewPhoto,
  ownerForFixture,
  photoFor,
  recordPreviewChange,
} from './previewRows';

const scope = {
  userId: v.string(),
  athleteId: v.number(),
  epoch: v.string(),
};
const scopeKey = v.object(scope);
const photoLimit = 100;
const pageLimit = 128;
const bootstrapPageLimit = 500;

async function getOwner(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query('previewOwners')
    .withIndex('user', (q) => q.eq('userId', userId))
    .unique();
}

export async function requireOwner(ctx: QueryCtx, args: typeof scopeKey.type) {
  const owner = await getOwner(ctx, args.userId);
  if (
    owner?.epoch !== args.epoch ||
    owner.athleteId !== args.athleteId ||
    owner.erasing ||
    (owner.fixtureAccount &&
      !['active', 'blocked'].includes(
        (await ctx.db.get('ingestionAccounts', owner.fixtureAccount))?.state ??
          '',
      ))
  )
    throw new Error('Preview scope unavailable');
  if (owner.retainedRun) {
    const run = await ctx.db.get('matchingRuns', owner.retainedRun);
    const source =
      owner.retainedOwner &&
      (await ctx.db.get('matchingOwners', owner.retainedOwner));
    if (
      !run ||
      run.state !== 'ready' ||
      run.fixtureAccount ||
      (run.expiresAt !== undefined && run.expiresAt <= Date.now()) ||
      !source ||
      source.run !== run._id ||
      source.generation !== run.generation
    )
      throw new Error('Retained library unavailable');
  }
  return owner;
}

const nullableNumber = v.union(v.null(), v.number());
const nullableString = v.union(v.null(), v.string());
export const operation = v.union(
  v.object({ kind: v.literal('head') }),
  v.object({
    kind: v.literal('bootstrap'),
    resource: v.union(v.literal('activities'), v.literal('photos')),
    after: nullableString,
    limit: v.number(),
  }),
  v.object({ kind: v.literal('retention'), cutoff: v.number() }),
  v.object({
    kind: v.literal('activities'),
    after: nullableNumber,
    limit: v.number(),
  }),
  v.object({
    kind: v.literal('photos'),
    after: nullableString,
    limit: v.number(),
  }),
  v.object({
    kind: v.literal('changes'),
    after: v.number(),
    limit: v.number(),
  }),
  v.object({ kind: v.literal('activityIds'), ids: v.array(v.number()) }),
  v.object({ kind: v.literal('photoIds'), ids: v.array(v.string()) }),
  v.object({ kind: v.literal('summaries'), ids: v.array(v.number()) }),
  v.object({ kind: v.literal('status'), after: nullableNumber }),
);

export const read = internalQuery({
  args: { ...scope, operation },
  handler: async (ctx, { operation: op, ...args }) => {
    const owner = await requireOwner(ctx, args);
    const id = owner._id;
    let source: Promise<ProjectionSource> | undefined;
    const getSource = () => (source ??= projectionSource(ctx, owner));
    if (
      'limit' in op &&
      (!Number.isInteger(op.limit) ||
        op.limit < 1 ||
        op.limit > (op.kind === 'bootstrap' ? bootstrapPageLimit : pageLimit))
    )
      throw new Error('Invalid preview page size');
    if ('ids' in op && op.ids.length > pageLimit)
      throw new Error('Too many preview IDs');
    switch (op.kind) {
      case 'bootstrap': {
        const binding = await getSource();
        const head = {
          sequence: owner.sequence,
          lastSummaryReconciledAt: owner.lastSummaryReconciledAt ?? null,
          matchingVersion: owner.matchingVersion ?? null,
        };
        // Small database reads within ONE query avoid remote round trips. The
        // explicit continuation also permits pages to stop at a byte budget.
        let after = op.after;
        let size = 2;
        const items: Record<string, unknown>[] = [];
        if (
          op.resource === 'activities' &&
          after !== null &&
          (!Number.isSafeInteger(Number(after)) || Number(after) < 1)
        )
          throw new Error('Invalid activity cursor');
        while (items.length < op.limit) {
          const count = Math.min(32, op.limit - items.length);
          const rows =
            op.resource === 'activities'
              ? await ctx.db
                  .query('previewActivities')
                  .withIndex('owner_activity', (q) =>
                    after === null
                      ? q.eq('owner', id)
                      : q.eq('owner', id).gt('id', Number(after)),
                  )
                  .take(count)
              : await ctx.db
                  .query('previewPhotos')
                  .withIndex('owner_photo', (q) =>
                    after === null
                      ? q.eq('owner', id)
                      : q.eq('owner', id).gt('id', after),
                  )
                  .take(count);
          const projected = await Promise.all(
            rows.map((row) =>
              op.resource === 'activities'
                ? projectActivity(
                    ctx,
                    owner,
                    row as Doc<'previewActivities'>,
                    binding,
                  )
                : Promise.resolve(row.dto),
            ),
          );
          for (const row of projected) {
            const nextSize = bytes(row) + Number(items.length > 0);
            if (size + nextSize > MAX_PAGE_BYTES)
              return { head, resource: op.resource, items, more: true };
            items.push(row);
            size += nextSize;
          }
          if (rows.length < count)
            return { head, resource: op.resource, items, more: false };
          after = String(rows.at(-1)!.id);
        }
        return { head, resource: op.resource, items, more: true };
      }
      case 'head':
        return {
          sequence: owner.sequence,
          lastSummaryReconciledAt: owner.lastSummaryReconciledAt ?? null,
          matchingVersion: owner.matchingVersion ?? null,
        };
      case 'retention': {
        const lastExpired = await ctx.db
          .query('previewChanges')
          .withIndex('owner_time', (q) =>
            q.eq('owner', id).lt('changedAt', op.cutoff),
          )
          .order('desc')
          .first();
        return Math.max(owner.retentionFloor ?? 0, lastExpired?.sequence ?? 0);
      }
      case 'activities': {
        const rows = await ctx.db
          .query('previewActivities')
          .withIndex('owner_activity', (q) =>
            op.after === null
              ? q.eq('owner', id)
              : q.eq('owner', id).gt('id', op.after),
          )
          .take(op.limit);
        const binding = await getSource();
        return Promise.all(
          rows.map((row) => projectActivity(ctx, owner, row, binding)),
        );
      }
      case 'photos': {
        const rows = await ctx.db
          .query('previewPhotos')
          .withIndex('owner_photo', (q) =>
            op.after === null
              ? q.eq('owner', id)
              : q.eq('owner', id).gt('id', op.after),
          )
          .take(op.limit);
        return rows.map((row) => row.dto);
      }
      case 'changes': {
        const rows = await ctx.db
          .query('previewChanges')
          .withIndex('owner_sequence', (q) =>
            q.eq('owner', id).gt('sequence', op.after),
          )
          .take(op.limit);
        return rows.map(
          ({ sequence, entityType, entityId, operation, changedAt }) => ({
            sequence,
            entityType,
            entityId,
            operation,
            changedAt,
          }),
        );
      }
      case 'activityIds': {
        const binding = await getSource();
        const rows = await Promise.all(
          op.ids.map((key) => activityFor(ctx, id, key)),
        );
        return Promise.all(
          rows.flatMap((row) =>
            row ? [projectActivity(ctx, owner, row, binding)] : [],
          ),
        );
      }
      case 'photoIds': {
        const rows = await Promise.all(
          op.ids.map((key) => photoFor(ctx, id, key)),
        );
        return rows.flatMap((row) => (row ? [row.dto] : []));
      }
      case 'summaries': {
        const result = await Promise.all(
          op.ids.map(async (key) => {
            const row = await activityFor(ctx, id, key);
            if (!row) return null;
            const state = await streamState(ctx, owner, row, await getSource());
            const summary = state?.current
              ? await ctx.db.get('recordingSummaries', state.manifest.summary)
              : null;
            return {
              activityId: String(key),
              metadata: state ? metadata(state) : null,
              summary: summary?.summary ?? null,
            };
          }),
        );
        return result.filter((row) => row !== null);
      }
      case 'status': {
        const account = owner.fixtureAccount
          ? await ctx.db.get('ingestionAccounts', owner.fixtureAccount)
          : null;
        const rows = await ctx.db
          .query('previewActivities')
          .withIndex('owner_activity', (q) =>
            op.after === null
              ? q.eq('owner', id)
              : q.eq('owner', id).gt('id', op.after),
          )
          .take(96);
        const counts = {
          total: rows.length,
          detailed: 0,
          neverFetched: 0,
          invalidatedDetails: 0,
          activitiesWithPhotos: 0,
          activitiesWithStoredPhotos: 0,
          currentPhotos: 0,
          refreshRequiredPhotos: 0,
          unknownPhotos: 0,
          photoCount: 0,
          withData: 0,
          withoutData: 0,
          runnable: 0,
          waiting: 0,
          blocked: 0,
          invalidatedStreams: 0,
          chartSummaries: 0,
        };
        let oldest: string | null = null;
        let newest: string | null = null;
        let retryAt: number | null = null;
        await Promise.all(
          rows.map(async (row) => {
            const state = await streamState(ctx, owner, row, await getSource());
            const job =
              account &&
              (await ctx.db
                .query('ingestionJobs')
                .withIndex('account_key', (q) =>
                  q.eq('account', account._id).eq('key', String(row.id)),
                )
                .unique());
            const summary = state?.current
              ? await ctx.db.get('recordingSummaries', state.manifest.summary)
              : null;
            const activity = activityDTOSchema.parse(row.dto);
            if (activity.geometry_state === 'detailed') counts.detailed++;
            else if (activity.geometry_state === 'refresh_required')
              counts.invalidatedDetails++;
            else counts.neverFetched++;
            const stored = row.storedPhotos ?? 0;
            counts.photoCount += stored;
            if (
              (activity.total_photo_count ?? activity.photo_count ?? 0) > 0 ||
              stored > 0
            ) {
              counts.activitiesWithPhotos++;
              if (stored > 0) counts.activitiesWithStoredPhotos++;
              if (activity.photos_state === 'current') counts.currentPhotos++;
              else if (activity.photos_state === 'refresh_required')
                counts.refreshRequiredPhotos++;
              else counts.unknownPhotos++;
            }
            if (state?.current) {
              if (
                Object.values(state.manifest.manifest.counts).some(
                  (count) => count > 0,
                )
              )
                counts.withData++;
              else counts.withoutData++;
              if (summary?.summary) counts.chartSummaries++;
            } else {
              if (state) counts.invalidatedStreams++;
              if (account?.state === 'blocked') counts.blocked++;
              else if (job?.due && job.failures > 0) {
                counts.waiting++;
                retryAt =
                  retryAt === null ? job.due : Math.min(retryAt, job.due);
              } else counts.runnable++;
            }
            if (oldest === null || activity.start_date < oldest)
              oldest = activity.start_date;
            if (newest === null || activity.start_date > newest)
              newest = activity.start_date;
          }),
        );
        return {
          counts,
          oldest,
          newest,
          retryAt,
          next: rows.length === 96 ? rows.at(-1)!.id : null,
          active: account?.state === 'active',
          lastSummaryReconciledAt: owner.lastSummaryReconciledAt ?? null,
        };
      }
    }
  },
});

export const raw = internalQuery({
  args: { ...scope, id: v.number() },
  handler: async (ctx, { id, ...args }) => {
    const owner = await requireOwner(ctx, args);
    const row = await activityFor(ctx, owner._id, id);
    if (!row) return null;
    const state = await streamState(ctx, owner, row);
    return {
      metadata: state ? metadata(state) : null,
      file: state?.current ? state.manifest.file : null,
    };
  },
});

/** Internal fixture control. Granting HTTP read access requires a separate secret. */
export const register = internalMutation({
  args: {
    ...scope,
    fixtureAccount: v.optional(v.id('ingestionAccounts')),
    lastSummaryReconciledAt: v.optional(v.number()),
    matchingVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await getOwner(ctx, args.userId);
    if (
      !Number.isSafeInteger(args.athleteId) ||
      args.athleteId < 1 ||
      !/^[A-Za-z0-9_-]{16,80}$/.test(args.epoch) ||
      (args.matchingVersion && !/^[0-9a-f]{64}$/.test(args.matchingVersion))
    )
      throw new Error('Invalid preview registration');
    if (args.fixtureAccount) {
      const account = await ctx.db.get(
        'ingestionAccounts',
        args.fixtureAccount,
      );
      if (!account || account.state === 'revoked')
        throw new Error('Fixture account unavailable');
      const bound = await ownerForFixture(ctx, args.fixtureAccount);
      if (bound && bound._id !== existing?._id)
        throw new Error('Fixture account already in use');
    }
    if (existing) {
      if (
        existing.erasing ||
        existing.athleteId !== args.athleteId ||
        existing.fixtureAccount !== args.fixtureAccount
      )
        throw new Error(
          'Preview owner identity and fixture binding are immutable',
        );
      await ctx.db.patch('previewOwners', existing._id, args);
      return existing._id;
    }
    return ctx.db.insert('previewOwners', {
      ...args,
      sequence: 0,
      projectionVersion: PROJECTION_VERSION,
    });
  },
});

export const publish = internalMutation({
  args: {
    ...scope,
    activity: v.optional(v.any()),
    photo: v.optional(v.any()),
    deleteActivity: v.optional(v.number()),
    deletePhoto: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { activity, photo, deleteActivity, deletePhoto, ...args },
  ) => {
    const owner = await requireOwner(ctx, args);
    const id = owner._id;
    if (
      [activity, photo, deleteActivity, deletePhoto].filter(
        (value) => value !== undefined,
      ).length !== 1
    )
      throw new Error('Expected exactly one preview update');
    if (activity !== undefined) {
      // Stream metadata and matches are derived from the fenced recording.
      const {
        streams: _streams,
        placeMatches: _matches,
        ...dto
      } = activityDTOSchema.parse(activity);
      const key = Number(dto.id);
      if (
        dto.athlete !== String(owner.athleteId) ||
        !Number.isSafeInteger(key) ||
        String(key) !== dto.id ||
        (dto.upload_id !== null &&
          !Number.isSafeInteger(Number(dto.upload_id))) ||
        key < 1 ||
        bytes(dto) > 64 * 1024
      )
        throw new Error('Invalid preview activity');
      const prior = await activityFor(ctx, id, key);
      const job =
        owner.fixtureAccount &&
        (await ctx.db
          .query('ingestionJobs')
          .withIndex('account_key', (q) =>
            q.eq('account', owner.fixtureAccount!).eq('key', dto.id),
          )
          .unique());
      if (job && job.deleted)
        throw new Error('Cannot resurrect a deleted fixture');
      if (prior)
        await ctx.db.patch('previewActivities', prior._id, {
          dto,
          target: job ? job.target : undefined,
        });
      else
        await ctx.db.insert('previewActivities', {
          owner: id,
          id: key,
          dto,
          target: job ? job.target : undefined,
        });
      await recordPreviewChange(ctx, id, 'activity', dto.id, 'upsert');
    } else if (photo !== undefined) {
      const dto = photoDTOSchema.parse(photo);
      const activityId = Number(dto.activity_id);
      const parent = await activityFor(ctx, id, activityId);
      if (
        dto.athlete_id !== String(owner.athleteId) ||
        String(activityId) !== dto.activity_id ||
        dto.unique_id.length === 0 ||
        dto.unique_id.length > 128 ||
        !parent ||
        bytes(dto) > 16 * 1024 ||
        Object.values(dto.urls ?? {}).some(
          (value) => !isProviderPhotoUrl(value),
        )
      )
        throw new Error('Invalid preview photo');
      const prior = await photoFor(ctx, id, dto.unique_id);
      if (prior && prior.activityId !== activityId)
        throw new Error('Photo activity is immutable');
      if (prior) await ctx.db.patch('previewPhotos', prior._id, { dto });
      else {
        const rows = await ctx.db
          .query('previewPhotos')
          .withIndex('owner_activity', (q) =>
            q.eq('owner', id).eq('activityId', activityId),
          )
          .take(photoLimit);
        if (rows.length === photoLimit)
          throw new Error('Preview photo limit exceeded');
        await ctx.db.insert('previewPhotos', {
          owner: id,
          id: dto.unique_id,
          activityId,
          dto,
        });
        await ctx.db.patch('previewActivities', parent._id, {
          storedPhotos: rows.length + 1,
        });
      }
      await recordPreviewChange(ctx, id, 'photo', dto.unique_id, 'upsert');
    } else if (deleteActivity !== undefined) {
      const prior = await activityFor(ctx, id, deleteActivity);
      if (prior?.target)
        throw new Error('Delete linked activities through fixture ingestion');
      if (prior) await deletePreviewActivity(ctx, prior);
    } else if (deletePhoto !== undefined) {
      const prior = await photoFor(ctx, id, deletePhoto);
      if (prior) await deletePreviewPhoto(ctx, prior);
    }
  },
});

function isProviderPhotoUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /(^|\.)(strava\.com|strava-cdn\.com)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Disable reads immediately, then erase only this preview's materialized data.
 * Fixture recordings are owned and erased separately by fixture-account revocation. */
export const erase = internalMutation({
  args: { ...scope },
  handler: async (ctx, args) => {
    const owner = await getOwner(ctx, args.userId);
    if (owner?.epoch !== args.epoch || owner.athleteId !== args.athleteId)
      return;
    await ctx.db.patch('previewOwners', owner._id, { erasing: true });
    await ctx.scheduler.runAfter(0, internal.preview.eraseBatch, {
      owner: owner._id,
    });
  },
});

export const eraseBatch = internalMutation({
  args: { owner: v.id('previewOwners') },
  handler: async (ctx, { owner }) => {
    const scope = await ctx.db.get('previewOwners', owner);
    if (!scope?.erasing) return;
    const batches = await Promise.all([
      ctx.db
        .query('previewActivities')
        .withIndex('owner_activity', (q) => q.eq('owner', owner))
        .take(32),
      ctx.db
        .query('previewPhotos')
        .withIndex('owner_photo', (q) => q.eq('owner', owner))
        .take(32),
      ctx.db
        .query('previewChanges')
        .withIndex('owner_sequence', (q) => q.eq('owner', owner))
        .take(128),
    ]);
    for (const row of batches.flat()) await ctx.db.delete(row._id);
    if (batches.some((batch) => batch.length > 0))
      await ctx.scheduler.runAfter(0, internal.preview.eraseBatch, { owner });
    else await ctx.db.delete('previewOwners', owner);
  },
});

/** Prune an owner in bounded batches and preserve the high-water and floor. */
export const compact = internalMutation({
  args: { ...scope },
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx, args);
    const cutoff = Date.now() - 90 * 86_400_000;
    const rows = await ctx.db
      .query('previewChanges')
      .withIndex('owner_time', (q) =>
        q.eq('owner', owner._id).lt('changedAt', cutoff),
      )
      .take(128);
    for (const row of rows) await ctx.db.delete('previewChanges', row._id);
    if (rows.length > 0)
      await ctx.db.patch('previewOwners', owner._id, {
        retentionFloor: Math.max(
          owner.retentionFloor ?? 0,
          ...rows.map((row) => row.sequence),
        ),
      });
    return rows.length;
  },
});
