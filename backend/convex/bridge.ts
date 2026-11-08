import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

/** Record a write nonce once. A repeated nonce means a replayed request. */
export const consumeNonce = internalMutation({
  args: { nonce: v.string(), expiresAt: v.number() },
  handler: async (ctx, { nonce, expiresAt }) => {
    const seen = await ctx.db
      .query('bridgeNonces')
      .withIndex('by_nonce', (q) => q.eq('nonce', nonce))
      .unique();
    if (seen) return false;
    await ctx.db.insert('bridgeNonces', { nonce, expiresAt });
    return true;
  },
});

const PAGE_SIZE = 256;

/** Expired nonces can no longer be replayed: the signature window rejects
 * their timestamps first. */
export const expireNonces = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const rows = await ctx.db
      .query('bridgeNonces')
      .withIndex('by_expiry', (q) => q.lt('expiresAt', Date.now()))
      .take(PAGE_SIZE);
    for (const row of rows) await ctx.db.delete('bridgeNonces', row._id);
    if (rows.length === PAGE_SIZE)
      await ctx.scheduler.runAfter(0, internal.bridge.expireNonces, {});
    return rows.length;
  },
});
