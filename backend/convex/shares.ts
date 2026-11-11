import { v } from 'convex/values';

import { toSharedActivityDTO } from '../../src/contracts/share/activity';
import type { StoredStreamSummary } from '../../src/lib/streams/compact-summary';
import { internalMutation, internalQuery } from './_generated/server';
import { activityFor } from './activityWrites';
import { currentRecording, project } from './liveProjection';
import { scopeFields } from './ownerScope';
import { idKey, requireWritableOwner } from './owners';

/**
 * Private share links for an account Convex writes for. A link is a hashed
 * capability token, an expiry, the athlete's one option (whether routes keep
 * their true ends) and an explicit set of the owner's activities. The app
 * creates the token and keeps the plaintext out of every store; this file
 * sees only its SHA-256.
 *
 * What a recipient gets is assembled here by the same allow-list the
 * Postgres path uses (`src/contracts/share/activity.ts`): route, name,
 * sport, date and the basic summary, never health, power or social fields.
 */

const MAX_ACTIVITIES = 200;
const MAX_LINKS_LISTED = 200;
const hash = v.string();
const fields = v.object({ showRouteEnds: v.boolean() });

const summaryOf = (link: {
  _id: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
  fields: { showRouteEnds: boolean };
  activities: string[];
}) => ({
  id: link._id,
  createdAt: link.createdAt,
  expiresAt: link.expiresAt,
  revokedAt: link.revokedAt ?? null,
  fields: link.fields,
  activityIds: link.activities.map((key) => key.replace(/^0+/, '')),
});

/** Create a link for activities that are all in the owner's library; null
 * when one of them is not, so nothing is ever shared short. */
export const create = internalMutation({
  args: {
    scope: v.object(scopeFields),
    tokenHash: hash,
    expiresAt: v.number(),
    fields,
    activityIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = await requireWritableOwner(ctx, args.scope, 'convex');
    const now = Date.now();
    if (
      // SHA-256, base64url (src/server/sharing/tokens.ts).
      !/^[A-Za-z0-9_-]{43}$/.test(args.tokenHash) ||
      args.activityIds.length < 1 ||
      args.activityIds.length > MAX_ACTIVITIES ||
      !Number.isSafeInteger(args.expiresAt) ||
      args.expiresAt <= now
    )
      throw new Error('Invalid share link');
    const keys = [...new Set(args.activityIds.map(idKey))];
    for (const key of keys) {
      const row = await activityFor(ctx, owner._id, key);
      if (!row || !project(row, owner)) return null;
    }
    const taken = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('tokenHash', args.tokenHash))
      .unique();
    if (taken) throw new Error('Invalid share link');
    const id = await ctx.db.insert('shareLinks', {
      owner: owner._id,
      tokenHash: args.tokenHash,
      createdAt: now,
      expiresAt: args.expiresAt,
      fields: args.fields,
      activities: keys,
    });
    return summaryOf((await ctx.db.get('shareLinks', id))!);
  },
});

/** The owner's links, newest first, whatever their status. */
export const list = internalQuery({
  args: { scope: v.object(scopeFields) },
  handler: async (ctx, { scope }) => {
    const owner = await requireWritableOwner(ctx, scope, 'convex');
    const links = await ctx.db
      .query('shareLinks')
      .withIndex('by_owner', (q) => q.eq('owner', owner._id))
      .order('desc')
      .take(MAX_LINKS_LISTED);
    return links.map(summaryOf);
  },
});

/** Revoke one of the owner's links. False for an unknown ID and for a link
 * of another owner alike. */
export const revoke = internalMutation({
  args: { scope: v.object(scopeFields), id: v.string() },
  handler: async (ctx, { scope, id }): Promise<boolean> => {
    const owner = await requireWritableOwner(ctx, scope, 'convex');
    const linkId = ctx.db.normalizeId('shareLinks', id);
    const link = linkId && (await ctx.db.get('shareLinks', linkId));
    if (!link || link.owner !== owner._id) return false;
    if (link.revokedAt === undefined)
      await ctx.db.patch('shareLinks', link._id, { revokedAt: Date.now() });
    return true;
  },
});

/**
 * What a token discloses, or null for every way it can fail (unknown,
 * revoked, expired, or its owner gone), which the caller must not tell
 * apart. An activity that was deleted or made private since is left out.
 * `athleteId` is for the caller's own check of the provider connection.
 */
export const view = internalQuery({
  args: { tokenHash: hash },
  handler: async (ctx, { tokenHash }) => {
    const link = await ctx.db
      .query('shareLinks')
      .withIndex('by_token', (q) => q.eq('tokenHash', tokenHash))
      .unique();
    if (!link || link.revokedAt !== undefined || link.expiresAt <= Date.now())
      return null;
    const owner = await ctx.db.get('owners', link.owner);
    if (!owner || owner.revoked) return null;
    const activities = [];
    for (const key of link.activities) {
      const row = await activityFor(ctx, owner._id, key);
      const item = row && project(row, owner);
      if (!row || !item || item.private) continue;
      const recording = await currentRecording(ctx, row, item);
      activities.push(
        toSharedActivityDTO(
          item,
          link.fields,
          (recording?.summary ?? null) as StoredStreamSummary | null,
        ),
      );
    }
    return {
      athleteId: owner.athleteId,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      fields: link.fields,
      activities,
    };
  },
});
