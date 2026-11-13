import { ConvexError, v } from 'convex/values';

import type { ActivityDTO } from '../../src/contracts/v1/activity';
import {
  SYNC_RETENTION_DAYS,
  SYNC_RETENTION_MS,
} from '../../src/contracts/v1/sync-policy';
import { placeMatchesFor } from '../../src/lib/sync/place-matches';
import type { Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import { PROJECTION_VERSION } from './activityProjection';
import { requireHead } from './owners';
import { photoPage } from './photos';
import { bootstrapPage, lastReconciledAt, resolvedChangesPage } from './sync';
import { requireViewer } from './viewer';

// A separate cursor namespace prevents either transport acknowledging the
// other's position. Tokens are not credentials: every read derives its owner
// from the authenticated JWT and validates the position against that owner.
const PREFIX = 'ios-convex-v1:';
const PAGE_BYTES = 384 * 1024;
const LIMIT = 256;

/** Match the HTTP projection for rows awaiting derived place results. */
function activity(item: ActivityDTO, owner: Doc<'owners'>): ActivityDTO {
  return {
    ...item,
    placeMatches: placeMatchesFor(item, owner.userId, owner.matchingVersion),
  };
}

function datasetVersion(owner: Doc<'owners'>) {
  return JSON.stringify([
    owner._id,
    owner.userId,
    owner.athleteId,
    owner.epoch,
    owner.generation,
  ]);
}

type Position = {
  version: string;
  sequence: number;
  issuedAt: number;
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
      !Number.isSafeInteger(value.issuedAt) ||
      value.issuedAt > Date.now() ||
      value.issuedAt + SYNC_RETENTION_MS <= Date.now() ||
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
    return {
      version: [
        datasetVersion(owner),
        owner.matchingVersion,
        owner.projectionVersion,
        PROJECTION_VERSION,
      ].join(':'),
      sequence: head.sequence,
      lastSummaryReconciledAt: await lastReconciledAt(ctx, owner),
    };
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
    const identity = datasetVersion(owner);
    const position = cursor === null ? null : decode(cursor, identity);
    const freshness = {
      lastSummaryReconciledAt: await lastReconciledAt(ctx, owner).then(
        (value) => (value === null ? null : new Date(value).toISOString()),
      ),
      placeMatchingVersion: owner.matchingVersion,
    };
    const issuedAt = position?.issuedAt ?? Date.now();
    const retentionFor = (issuedAt: number) => ({
      retentionDays: SYNC_RETENTION_DAYS,
      cursorValidUntil: new Date(issuedAt + SYNC_RETENTION_MS).toISOString(),
    });
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
      const nextIssuedAt =
        page.lastSequence === position.sequence ? issuedAt : Date.now();
      return JSON.stringify({
        items: page.items.map((item) =>
          item.activity
            ? { ...item, activity: activity(item.activity, owner) }
            : item,
        ),
        nextCursor: encode({
          version: identity,
          sequence: page.lastSequence,
          issuedAt: nextIssuedAt,
        }),
        freshness,
        retention: retentionFor(nextIssuedAt),
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
              issuedAt,
            })
          : null,
      snapshotCursor:
        resource === 'activities' && cursor === null
          ? encode({ version: identity, sequence: head.sequence, issuedAt })
          : null,
      freshness,
      retention: retentionFor(issuedAt),
    });
  },
});
