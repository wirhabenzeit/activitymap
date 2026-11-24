import { v } from 'convex/values';

import { SYNC_RETENTION_MS as RETENTION_MS } from '../../src/contracts/v1/sync-policy';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

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
      const head = await ctx.db
        .query('ownerHeads')
        .withIndex('by_owner', (q) => q.eq('owner', owner))
        .unique();
      // Erased/migrating owners must not stall maintenance for everyone else.
      if (!head) continue;
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

const WALK_RESTARTS = 16;

/** Start the re-match walk (`catalogue.rematchTiles`) again for completed
 * revisions that still have tile changes. A walk deletes each tile's row
 * once it has finished it, so rows left are unfinished work: of a walk
 * still under way, or of one that stopped. A second walk over the same
 * tiles is harmless. Rows of a pending revision wait for its completion.
 * Returns the revisions whose walk was started. */
export const resumeRematchWalks = internalMutation({
  args: {},
  handler: async (ctx): Promise<number[]> => {
    const state = await ctx.db.query('placeCatalogueState').unique();
    if (!state) return [];
    const revisions: number[] = [];
    let row = await ctx.db
      .query('placeTileChanges')
      .withIndex('by_revision_tile')
      .first();
    while (
      row &&
      row.revision <= state.revision &&
      revisions.length < WALK_RESTARTS
    ) {
      const { revision } = row;
      revisions.push(revision);
      await ctx.scheduler.runAfter(0, internal.catalogue.rematchTiles, {
        revision,
      });
      row = await ctx.db
        .query('placeTileChanges')
        .withIndex('by_revision_tile', (q) => q.gt('revision', revision))
        .first();
    }
    return revisions;
  },
});

const EVENT_RETENTION_MS = 30 * 86_400_000;

/** Provider event receipts only keep a repeated delivery from counting
 * twice, and the app stops sending an event once it is recorded. */
export const expireProviderEvents = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const rows = await ctx.db
      .query('providerEvents')
      .withIndex('by_received', (q) =>
        q.lt('receivedAt', Date.now() - EVENT_RETENTION_MS),
      )
      .take(PAGE_SIZE);
    for (const row of rows) await ctx.db.delete('providerEvents', row._id);
    if (rows.length === PAGE_SIZE)
      await ctx.scheduler.runAfter(
        0,
        internal.maintenance.expireProviderEvents,
        {},
      );
    return rows.length;
  },
});
