import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import { internalQuery } from './_generated/server';
import {
  MAX_PAGE_BYTES,
  PROJECTION_VERSION,
  jsonBytes,
  projectedActivity,
} from './activityProjection';
import { activityFor } from './activityWrites';
import { idKey, requireHead, requireOwner, scopeFields } from './owners';

const id = v.string();
const cursor = v.union(id, v.null());
const resource = v.union(v.literal('activities'), v.literal('photos'));
const operation = v.union(
  v.object({ kind: v.literal('head') }),
  v.object({ kind: v.literal('retention'), cutoff: v.number() }),
  v.object({
    kind: v.literal('bootstrap'),
    resource,
    after: cursor,
    limit: v.number(),
  }),
  v.object({ kind: v.literal('activityIds'), ids: v.array(id) }),
  v.object({ kind: v.literal('summaries'), ids: v.array(id) }),
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
        let after = op.after === null ? '' : idKey(op.after);
        const items = [];
        let size = 2;
        while (items.length < op.limit) {
          const count = Math.min(32, op.limit - items.length);
          const rows = await ctx.db
            .query('activities')
            .withIndex('by_owner_live_key', (q) =>
              q
                .eq('owner', owner._id)
                .eq('generation', owner.generation)
                .eq('deleted', false)
                .gt('key', after),
            )
            .take(count);
          for (const row of rows) {
            const item = project(row, owner);
            if (!item) {
              after = row.key;
              continue;
            }
            size += jsonBytes(item) + Number(items.length > 0);
            if (size > MAX_PAGE_BYTES)
              return { ...response, items, more: true };
            items.push(item);
            after = row.key;
          }
          if (rows.length < count) return { ...response, items, more: false };
        }
        return { ...response, items, more: true };
      }
      case 'changes': {
        if (
          !Number.isSafeInteger(op.after) ||
          op.after < 0 ||
          op.after > feed!.sequence ||
          op.after < feed!.retentionFloor
        )
          throw new Error('Invalid sync sequence');
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
            const recording =
              row.recording && (await ctx.db.get('recordings', row.recording));
            const summary =
              recording &&
              recording.activity === row._id &&
              item.streams?.state === 'current' &&
              recording.sourceRevision === row.sourceRevision &&
              recording.generation === item.streams.generation &&
              recording.revision === item.streams.revision
                ? recording.summary
                : null;
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
    }
  },
});
