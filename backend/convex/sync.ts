import { ConvexError, v } from 'convex/values';

import type { ActivityDTO } from '~/contracts/v1/activity';
import type { SyncChangeItemDTO } from '~/contracts/v1/sync';

import type { Doc } from './_generated/dataModel';
import { type QueryCtx, internalQuery } from './_generated/server';
import { MAX_PAGE_BYTES } from './activityProjection';
import { activityFor } from './activityWrites';
import { boundary } from './library';
import { currentRecording, liveRows, project } from './liveProjection';
import {
  idKey,
  requireHead,
  requireOwner,
  scopeFields,
  writerOf,
} from './owners';
import {
  photoPage,
  photosByIds,
  photosOfActivities,
  storedPhotoCount,
} from './photos';

const id = v.string();
const cursor = v.union(id, v.null());
const resource = v.union(v.literal('activities'), v.literal('photos'));
const operation = v.union(
  v.object({ kind: v.literal('head') }),
  v.object({ kind: v.literal('retention') }),
  v.object({
    kind: v.literal('bootstrap'),
    resource,
    after: cursor,
    limit: v.number(),
  }),
  v.object({ kind: v.literal('activityIds'), ids: v.array(id) }),
  v.object({ kind: v.literal('summaries'), ids: v.array(id) }),
  // List pages for the v1 activity/photo endpoints.
  v.object({ kind: v.literal('activities'), after: cursor, limit: v.number() }),
  v.object({ kind: v.literal('photos'), after: cursor, limit: v.number() }),
  v.object({ kind: v.literal('photoIds'), ids: v.array(id) }),
  // The photos of whole activities, for the parity check.
  v.object({ kind: v.literal('activityPhotos'), ids: v.array(id) }),
  v.object({ kind: v.literal('status'), after: cursor }),
  v.object({ kind: v.literal('statusSummary') }),
  v.object({
    kind: v.literal('changes'),
    after: v.number(),
    limit: v.number(),
  }),
  v.object({
    kind: v.literal('changesPage'),
    after: v.number(),
    limit: v.number(),
  }),
);

const utf8 = new TextEncoder();

/** One bootstrap page of activities, bounded by `op.limit` and MAX_PAGE_BYTES.
 * Each item is serialized once: `json` holds the exact text of `items`, so the
 * HTTP bridge can send the page without re-serializing it. */
async function bootstrapPage(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  op: { after: string | null; limit: number },
) {
  let after = op.after === null ? '' : idKey(op.after);
  const items: ActivityDTO[] = [];
  const json: string[] = [];
  let size = 2;
  // Each `take` is a sequential index read, so size the next batch from the
  // remaining byte budget instead of reading a fixed 32 rows at a time.
  let batch = 64;
  while (items.length < op.limit) {
    const count = Math.min(batch, op.limit - items.length);
    const rows = await liveRows(ctx, owner, after, count);
    for (const row of rows) {
      const item = project(row, owner);
      if (!item) {
        after = row.key;
        continue;
      }
      const text = JSON.stringify(item);
      size += utf8.encode(text).length + Number(items.length > 0);
      if (size > MAX_PAGE_BYTES) return { items, json, more: true };
      items.push(item);
      json.push(text);
      after = row.key;
    }
    if (rows.length < count) return { items, json, more: false };
    const average = items.length > 0 ? (size - 2) / items.length : 0;
    batch =
      average > 0
        ? Math.min(
            256,
            Math.max(8, Math.ceil((MAX_PAGE_BYTES - size) / average) + 1),
          )
        : 256;
  }
  return { items, json, more: true };
}

const LIST_PAGE_LIMIT = 32;
// Photo documents are a few KiB of metadata each.
const PHOTO_PAGE_LIMIT = 500;
const STATUS_PAGE_LIMIT = 96;

/** Chart summaries and stream metadata for the owner's activities among
 * `ids`; unknown or deleted IDs are left out. */
export async function summariesFor(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  ids: string[],
) {
  const rows = await Promise.all(
    ids.map((key) => activityFor(ctx, owner._id, idKey(key))),
  );
  const summaries = await Promise.all(
    rows.map(async (row) => {
      if (!row || row.deleted) return null;
      const item = project(row, owner);
      if (!item) return null;
      const summary = (await currentRecording(ctx, row, item))?.summary ?? null;
      return {
        activityId: item.id,
        metadata: item.streams ?? null,
        summary,
      };
    }),
  );
  return summaries.filter((summary) => summary !== null);
}

export const read = internalQuery({
  args: { ...scopeFields, operation },
  handler: async (ctx, { operation: op, ...scope }) => {
    const owner = await requireOwner(ctx, scope);
    // Item/summary queries depend on assignment, not the frequently updated head.
    const feed = [
      'head',
      'bootstrap',
      'changes',
      'changesPage',
      'retention',
    ].includes(op.kind)
      ? await requireHead(ctx, owner._id)
      : null;
    const head = {
      sequence: feed?.sequence ?? 0,
      matchingVersion: owner.matchingVersion,
      lastSummaryReconciledAt: null,
    };
    if (
      'limit' in op &&
      (!Number.isInteger(op.limit) || op.limit < 1 || op.limit > 500)
    )
      throw new Error('Invalid sync page limit');
    switch (op.kind) {
      case 'retention':
        return feed!.retentionFloor;
      case 'head':
        return head;
      case 'bootstrap': {
        const response = { head, resource: op.resource };
        if (op.resource === 'photos') {
          const items = await photoPage(ctx, owner, op.after, op.limit);
          return { ...response, items, more: items.length === op.limit };
        }
        const { items, more } = await bootstrapPage(ctx, owner, op);
        return { ...response, items, more };
      }
      case 'changes':
      case 'changesPage': {
        if (
          !Number.isSafeInteger(op.after) ||
          op.after < 0 ||
          op.after > feed!.sequence
        )
          throw new ConvexError('sync_rebootstrap_required');
        if (op.after < feed!.retentionFloor)
          throw new ConvexError('sync_rebootstrap_required');
        const rows = await ctx.db
          .query('changes')
          .withIndex('by_owner_sequence', (q) =>
            q.eq('owner', owner._id).gt('sequence', op.after),
          )
          .take(op.limit);
        if (op.kind === 'changesPage') {
          // Resolve the feed and its current entities in ONE snapshot. Small
          // local batches bound read work when a page reaches its byte budget.
          const items: SyncChangeItemDTO[] = [];
          let lastSequence = op.after;
          let bytes = 2;
          for (let offset = 0; offset < rows.length; offset += 8) {
            const batch = rows.slice(offset, offset + 8);
            const resolved = await Promise.all(
              batch.map(async (change) => {
                const base = {
                  sequence: String(change.sequence),
                  entityType: change.entityType,
                  operation: change.operation,
                  id: change.entityId,
                };
                if (change.operation === 'delete') return base;
                if (change.entityType === 'activity') {
                  const row = await activityFor(
                    ctx,
                    owner._id,
                    idKey(change.entityId),
                  );
                  const activity = row && project(row, owner);
                  return activity ? { ...base, activity } : null;
                }
                const [photo] = await photosByIds(ctx, owner, [
                  change.entityId,
                ]);
                return photo ? { ...base, photo } : null;
              }),
            );
            for (let i = 0; i < batch.length; i++) {
              const item = resolved[i];
              if (item) {
                const size =
                  utf8.encode(JSON.stringify(item)).length +
                  Number(items.length > 0);
                // Always admit the first item; individual DTOs are bounded at
                // publication. Do not acknowledge the first deferred event.
                if (items.length > 0 && bytes + size > MAX_PAGE_BYTES)
                  return { head, items, lastSequence };
                bytes += size;
                items.push(item);
              }
              // Superseded upserts still advance, even on an empty page.
              lastSequence = batch[i]!.sequence;
            }
          }
          return { head, items, lastSequence };
        }
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
      case 'summaries': {
        if (op.ids.length > 48) throw new Error('Too many summary IDs');
        return summariesFor(ctx, owner, op.ids);
      }
      case 'activityIds': {
        // Explicitly bounded so one lookup cannot exceed the byte limit even
        // when every requested item is at the maximum projection size.
        if (op.ids.length > 8) throw new Error('Too many activity IDs');
        const rows = await Promise.all(
          op.ids.map((key) => activityFor(ctx, owner._id, idKey(key))),
        );
        return rows.flatMap((row) => {
          const item = row && project(row, owner);
          return item ? [item] : [];
        });
      }
      case 'activities': {
        // Each item is bounded by MAX_ACTIVITY_BYTES; a short page means the
        // end of the library, so cap the count instead of truncating by bytes.
        if (op.limit > LIST_PAGE_LIMIT)
          throw new Error('Invalid list page size');
        const rows = await liveRows(
          ctx,
          owner,
          op.after === null ? '' : idKey(op.after),
          op.limit,
        );
        return rows.flatMap((row) => {
          const item = project(row, owner);
          return item ? [item] : [];
        });
      }
      case 'photos': {
        if (op.limit > PHOTO_PAGE_LIMIT)
          throw new Error('Invalid list page size');
        return photoPage(ctx, owner, op.after, op.limit);
      }
      case 'photoIds': {
        if (op.ids.length > PHOTO_PAGE_LIMIT)
          throw new Error('Too many photo IDs');
        return photosByIds(ctx, owner, op.ids);
      }
      case 'activityPhotos': {
        // Up to MAX_PHOTOS_PER_ACTIVITY documents of a few KiB per activity.
        if (op.ids.length > 16) throw new Error('Too many activity IDs');
        return photosOfActivities(ctx, owner, op.ids);
      }
      case 'statusSummary': {
        // The status in one read, from the counts kept with every write
        // (convex/stats.ts). Null while they are being rebuilt; the paged
        // `status` operation then walks the library instead.
        const [stats, oldest, newest, sweep] = await Promise.all([
          ctx.db
            .query('ownerStats')
            .withIndex('by_owner', (q) => q.eq('owner', owner._id))
            .unique(),
          boundary(ctx, owner, 'asc'),
          boundary(ctx, owner, 'desc'),
          ctx.db
            .query('ingestionSweeps')
            .withIndex('by_owner', (q) => q.eq('owner', owner._id))
            .unique(),
        ]);
        if (!stats || stats.rebuildAfter !== undefined) return null;
        return {
          counts: stats.counts,
          oldest: oldest?.dto?.start_date ?? null,
          newest: newest?.dto?.start_date ?? null,
          retryAt: null,
          active: writerOf(owner) === 'convex',
          next: null,
          lastSummaryReconciledAt: sweep?.completedAt ?? null,
          sweep: sweep
            ? {
                phase: sweep.phase,
                page: sweep.page,
                scanStartedAt:
                  sweep.phase === 'idle' ? null : sweep.scanBefore * 1000,
                dueAt: sweep.dueAt,
                error: sweep.error ?? null,
              }
            : null,
        };
      }
      case 'status': {
        const rows = await liveRows(
          ctx,
          owner,
          op.after === null ? '' : idKey(op.after),
          STATUS_PAGE_LIMIT,
        );
        const counts = {
          total: 0,
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
        for (const row of rows) {
          const item = project(row, owner);
          if (!item) continue;
          counts.total++;
          if (item.geometry_state === 'detailed') counts.detailed++;
          else if (item.geometry_state === 'refresh_required')
            counts.invalidatedDetails++;
          else counts.neverFetched++;
          if ((item.total_photo_count ?? item.photo_count ?? 0) > 0) {
            counts.activitiesWithPhotos++;
            if (item.photos_state === 'current') counts.currentPhotos++;
            else if (item.photos_state === 'refresh_required')
              counts.refreshRequiredPhotos++;
            else counts.unknownPhotos++;
          }
          const photos = await storedPhotoCount(ctx, owner, row.key);
          counts.photoCount += photos;
          if (
            photos > 0 &&
            (item.total_photo_count ?? item.photo_count ?? 0) > 0
          )
            counts.activitiesWithStoredPhotos++;
          const recording = await currentRecording(ctx, row, item);
          if (recording) {
            if (Object.values(recording.manifest.counts).some((n) => n! > 0))
              counts.withData++;
            else counts.withoutData++;
            if (recording.summary) counts.chartSummaries++;
          } else if (item.streams?.state === 'stale') {
            counts.invalidatedStreams++;
            counts.runnable++;
          } else counts.runnable++;
          if (oldest === null || item.start_date < oldest)
            oldest = item.start_date;
          if (newest === null || item.start_date > newest)
            newest = item.start_date;
        }
        return {
          counts,
          oldest,
          newest,
          retryAt: null,
          // Jobs here fetch what is missing only for an owner Convex writes.
          active: writerOf(owner) === 'convex',
          next:
            rows.length === STATUS_PAGE_LIMIT ? Number(rows.at(-1)!.key) : null,
          lastSummaryReconciledAt: null,
        };
      }
    }
  },
});

/** The bootstrap page as the JSON text `read` would return for it. Returning
 * one string avoids converting a ~2 MB object tree into a Convex value, back
 * into the HTTP action, and serializing it again for the response. */
export const bootstrapJson = internalQuery({
  args: {
    ...scopeFields,
    operation: v.object({
      kind: v.literal('bootstrap'),
      resource,
      after: cursor,
      limit: v.number(),
    }),
  },
  handler: async (ctx, { operation: op, ...scope }) => {
    const owner = await requireOwner(ctx, scope);
    const feed = await requireHead(ctx, owner._id);
    const head = JSON.stringify({
      sequence: feed.sequence,
      matchingVersion: owner.matchingVersion,
      lastSummaryReconciledAt: null,
    });
    if (!Number.isInteger(op.limit) || op.limit < 1 || op.limit > 500)
      throw new Error('Invalid sync page limit');
    let page: { json: string[]; more: boolean };
    if (op.resource === 'photos') {
      const items = await photoPage(ctx, owner, op.after, op.limit);
      page = {
        json: items.map((item) => JSON.stringify(item)),
        more: items.length === op.limit,
      };
    } else page = await bootstrapPage(ctx, owner, op);
    return `{"head":${head},"resource":"${op.resource}","items":[${page.json.join(',')}],"more":${page.more}}`;
  },
});

/** Raw recordings are served as stored bytes by the HTTP bridge. Metadata is
 * returned even when no current recording exists. */
export const raw = internalQuery({
  args: { ...scopeFields, id },
  handler: async (ctx, { id: key, ...scope }) => {
    const owner = await requireOwner(ctx, scope);
    const row = await activityFor(ctx, owner._id, idKey(key));
    const item = row && project(row, owner);
    if (!row || !item) return null;
    const recording = await currentRecording(ctx, row, item);
    return {
      metadata: item.streams ?? null,
      ...(recording && { file: recording.file }),
    };
  },
});
