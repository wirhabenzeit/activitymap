import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { requireHead } from './owners';

const RETENTION_MS = 90 * 86_400_000;
const PAGE_SIZE = 256;

/** Delete bounded batches and retain the highest removed sequence per owner.
 * A client below that floor must bootstrap even if the whole feed was removed. */
export const compactChanges = internalMutation({
  args: { cutoff: v.optional(v.number()) },
  handler: async (ctx, args): Promise<number> => {
    const cutoff = Math.min(
      args.cutoff ?? Date.now() - RETENTION_MS,
      Date.now() - RETENTION_MS,
    );
    const rows = await ctx.db
      .query('changes')
      .withIndex('by_changed_at', (q) => q.lt('changedAt', cutoff))
      .take(PAGE_SIZE);
    const floors = new Map<(typeof rows)[number]['owner'], number>();
    for (const row of rows) {
      floors.set(row.owner, Math.max(floors.get(row.owner) ?? 0, row.sequence));
      await ctx.db.delete('changes', row._id);
    }
    for (const [owner, floor] of floors) {
      const head = await requireHead(ctx, owner);
      await ctx.db.patch('ownerHeads', head._id, {
        retentionFloor: Math.max(head.retentionFloor, floor),
      });
    }
    if (rows.length === PAGE_SIZE)
      await ctx.scheduler.runAfter(0, internal.maintenance.compactChanges, {
        cutoff,
      });
    return rows.length;
  },
});

/** The reference check and deletion share a transaction with publication's
 * file checks, so cleanup can never remove an accepted recording. */
export const cleanupRecording = internalMutation({
  args: { file: v.id('_storage') },
  handler: async (ctx, { file }) => {
    const reference = await ctx.db
      .query('recordings')
      .withIndex('by_file', (q) => q.eq('file', file))
      .unique();
    if (!reference && (await ctx.db.system.get('_storage', file)))
      await ctx.storage.delete(file);
  },
});
