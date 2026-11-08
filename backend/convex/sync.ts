import { ConvexError, v } from 'convex/values';

import type { ActivityDTO } from '~/contracts/v1/activity';

import type { Doc } from './_generated/dataModel';
import { type QueryCtx, internalQuery } from './_generated/server';
import {
  MAX_PAGE_BYTES,
  PROJECTION_VERSION,
  projectedActivity,
} from './activityProjection';
import { activityFor } from './activityWrites';
import { idKey, requireHead, requireOwner, scopeFields } from './owners';

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
  // List pages for the v1 activity/photo endpoints. Photos are not persisted
  // by this package yet, so photo reads are explicitly empty.
  v.object({ kind: v.literal('activities'), after: cursor, limit: v.number() }),
  v.object({ kind: v.literal('photos'), after: cursor, limit: v.number() }),
  v.object({ kind: v.literal('photoIds'), ids: v.array(id) }),
  v.object({ kind: v.literal('status'), after: cursor }),
  v.object({
    kind: v.literal('changes'),
    after: v.number(),
    limit: v.number(),
  }),
);

function project(row: Doc<'activities'>, owner: Doc<'owners'>) {
  if (!row.dto || row.deleted || row.generation !== owner.generation)
    return null;
  if (
    row.projection?.version !== PROJECTION_VERSION ||
    row.projection.generation !== owner.generation
  ) {
    // Preserve the activity in the library while a projection is rebuilt.
    // Omit derived state rather than presenting stale streams or matches.
    return { ...row.dto };
  }
  return projectedActivity(
    row.dto,
    row.projection,
    owner,
    owner.matchingVersion,
  );
}

/** A row's recording only while it still describes the projected streams. */
async function currentRecording(
  ctx: QueryCtx,
  row: Doc<'activities'>,
  item: Pick<Partial<ActivityDTO>, 'streams'>,
) {
  const recording =
    row.recording && (await ctx.db.get('recordings', row.recording));
  return recording &&
    recording.activity === row._id &&
    item.streams?.state === 'current' &&
    recording.sourceRevision === row.sourceRevision &&
    recording.generation === item.streams.generation &&
    recording.revision === item.streams.revision
    ? recording
    : null;
}

function liveRows(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  after: string,
  count: number,
) {
  return ctx.db
    .query('activities')
    .withIndex('by_owner_live_key', (q) =>
      q
        .eq('owner', owner._id)
        .eq('generation', owner.generation)
        .eq('deleted', false)
        .gt('key', after),
    )
    .take(count);
}

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
const STATUS_PAGE_LIMIT = 96;

export const read = internalQuery({
  args: { ...scopeFields, operation },
  handler: async (ctx, { operation: op, ...scope }) => {
    const owner = await requireOwner(ctx, scope);
    // Item/summary queries depend on assignment, not the frequently updated head.
    const feed = ['head', 'bootstrap', 'changes', 'retention'].includes(op.kind)
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
        if (op.resource === 'photos')
          return { ...response, items: [], more: false };
        const { items, more } = await bootstrapPage(ctx, owner, op);
        return { ...response, items, more };
      }
      case 'changes': {
        if (
          !Number.isSafeInteger(op.after) ||
          op.after < 0 ||
          op.after > feed!.sequence
        )
          throw new Error('Invalid sync sequence');
        if (op.after < feed!.retentionFloor)
          throw new ConvexError('sync_rebootstrap_required');
        const rows = await ctx.db
          .query('changes')
          .withIndex('by_owner_sequence', (q) =>
            q.eq('owner', owner._id).gt('sequence', op.after),
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
      case 'summaries': {
        if (op.ids.length > 48) throw new Error('Too many summary IDs');
        const rows = await Promise.all(
          op.ids.map((key) => activityFor(ctx, owner._id, idKey(key))),
        );
        const summaries = await Promise.all(
          rows.map(async (row) => {
            if (!row || row.deleted) return null;
            const item = project(row, owner);
            if (!item) return null;
            const summary =
              (await currentRecording(ctx, row, item))?.summary ?? null;
            return {
              activityId: item.id,
              metadata: item.streams ?? null,
              summary,
            };
          }),
        );
        return summaries.filter((summary) => summary !== null);
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
      case 'photos':
      case 'photoIds':
        return [];
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
          // Provider ingestion is not part of this package yet.
          active: false,
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
    const page =
      op.resource === 'photos'
        ? { json: [], more: false }
        : await bootstrapPage(ctx, owner, op);
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
