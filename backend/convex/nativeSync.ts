import { ConvexError, v } from 'convex/values';

import type { ActivityDTO } from '../../src/contracts/v1/activity';
import { MATCHER_VERSION } from '../../src/server/places/matcher-version';
import type { Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import { PROJECTION_VERSION } from './activityProjection';
import { requireHead } from './owners';
import { photoPage } from './photos';
import { bootstrapPage, resolvedChangesPage } from './sync';
import { requireViewer } from './viewer';

// A separate cursor namespace prevents either transport acknowledging the
// other's position. Tokens are not credentials: every read derives its owner
// from the authenticated JWT and validates the position against that owner.
const PREFIX = 'ios-convex-v1:';
const PAGE_BYTES = 384 * 1024;
const LIMIT = 256;
const DAYS = 90;

/** Match the HTTP projection for rows awaiting derived place results. */
function activity(item: ActivityDTO, owner: Doc<'owners'>): ActivityDTO {
  return {
    ...item,
    placeMatches: item.placeMatches ?? {
      activityId: item.id,
      userId: owner.userId,
      status: item.streams?.state === 'current' ? 'pending' : 'missing_streams',
      streamGeneration: item.streams?.generation ?? null,
      streamRevision: item.streams?.revision ?? '0',
      catalogueSnapshotId: null,
      matcherVersion: MATCHER_VERSION,
      matchingVersion: owner.matchingVersion,
      resultRevision: null,
      places: [],
    },
  };
}

function version(owner: Doc<'owners'>) {
  return [
    owner.userId,
    owner.epoch,
    owner.generation,
    owner.matchingVersion,
    owner.projectionVersion,
    PROJECTION_VERSION,
  ].join(':');
}

type Position = {
  version: string;
  sequence: number;
  resource?: string;
  after?: string;
};
function encode(position: Position) {
  return PREFIX + JSON.stringify(position);
}
function decode(cursor: string, identity: string): Position {
  try {
    if (!cursor.startsWith(PREFIX) || cursor.length > 4096) throw new Error();
    const value: Position = JSON.parse(cursor.slice(PREFIX.length));
    if (
      value.version !== identity ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0 ||
      (value.after !== undefined && typeof value.after !== 'string')
    )
      throw new Error();
    return value;
  } catch {
    throw new ConvexError('sync_rebootstrap_required');
  }
}

/** One tiny live subscription; data pages are read once on demand. */
export const head = query({
  args: {},
  handler: async (ctx) => {
    const owner = await requireViewer(ctx);
    const head = await requireHead(ctx, owner._id);
    return { version: version(owner), sequence: head.sequence };
  },
});

/** Full v1 DTOs, including detailed routes, consumed by the existing SwiftData
 * sync engine. JSON preserves its ISO dates and snake_case contract without
 * depending on the SDK decoder's date strategy. Bounded below Convex's result
 * size limit, including the JSON string encoding overhead. */
export const read = query({
  args: {
    resource: v.union(
      v.literal('activities'),
      v.literal('photos'),
      v.literal('changes'),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { resource, cursor }) => {
    const owner = await requireViewer(ctx);
    const head = await requireHead(ctx, owner._id);
    const identity = version(owner);
    const position = cursor === null ? null : decode(cursor, identity);
    const freshness = {
      lastSummaryReconciledAt: null,
      placeMatchingVersion: owner.matchingVersion,
    };
    const retention = {
      retentionDays: DAYS,
      cursorValidUntil: new Date(Date.now() + DAYS * 86400000).toISOString(),
    };
    if (resource === 'changes') {
      if (
        !position ||
        position.resource !== undefined ||
        position.sequence < head.retentionFloor ||
        position.sequence > head.sequence
      )
        throw new ConvexError('sync_rebootstrap_required');
      const rows = await ctx.db
        .query('changes')
        .withIndex('by_owner_sequence', (q) =>
          q.eq('owner', owner._id).gt('sequence', position.sequence),
        )
        .take(LIMIT);
      const page = await resolvedChangesPage(
        ctx,
        owner,
        rows,
        position.sequence,
        PAGE_BYTES,
      );
      return JSON.stringify({
        items: page.items.map((item) =>
          item.activity
            ? { ...item, activity: activity(item.activity, owner) }
            : item,
        ),
        nextCursor: encode({ version: identity, sequence: page.lastSequence }),
        freshness,
        retention,
      });
    }
    if (position && position.resource !== resource)
      throw new ConvexError('sync_rebootstrap_required');
    const after = position?.after ?? null;
    const page =
      resource === 'activities'
        ? await bootstrapPage(ctx, owner, { after, limit: LIMIT }, PAGE_BYTES)
        : await (async () => {
            // Photos are bounded individually at publication; keep this page small.
            const read = await photoPage(ctx, owner, after, 32);
            const items = [];
            let bytes = 2;
            for (const item of read) {
              const size =
                new TextEncoder().encode(JSON.stringify(item)).length + 1;
              if (items.length && bytes + size > PAGE_BYTES) break;
              items.push(item);
              bytes += size;
            }
            return {
              items,
              more: items.length < read.length || read.length === 32,
            };
          })();
    const last = page.items.at(-1);
    const next = last && ('id' in last ? last.id : last.unique_id);
    return JSON.stringify({
      resource,
      items:
        resource === 'activities'
          ? page.items.map((item) => activity(item as ActivityDTO, owner))
          : page.items,
      nextCursor:
        page.more && next
          ? encode({
              version: identity,
              sequence: position?.sequence ?? head.sequence,
              resource,
              after: next,
            })
          : null,
      snapshotCursor:
        resource === 'activities' && cursor === null
          ? encode({ version: identity, sequence: head.sequence })
          : null,
      freshness,
      retention,
    });
  },
});
