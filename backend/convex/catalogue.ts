import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { type MutationCtx, internalMutation } from './_generated/server';
import { publishChange } from './activityWrites';
import { ingests, requestMatch } from './ingestion';
import { writerValidator } from './ownerScope';
import {
  ownerFor,
  requireHead,
  requireWritableOwner,
  scopeFields,
  writerOf,
} from './owners';

/** How many activities one step of the walk handles, and how long it waits
 * before the next: a rematch asks for about eight matches a second. */
const WALK_PAGE = 16;
const REMATCH_PAUSE_MS = 2_000;
const OWNER_PAGE = 32;

const identity = {
  catalogue: v.string(),
  matchingVersion: v.string(),
};

/** Point an owner at a catalogue and start the walk over its library.
 * False when the owner already has it. */
async function selectFor(
  ctx: MutationCtx,
  owner: Doc<'owners'>,
  {
    catalogue,
    matchingVersion,
  }: { catalogue: string; matchingVersion: string },
) {
  if (
    !/^[0-9a-f]{64}$/.test(catalogue) ||
    !/^[0-9a-f]{64}$/.test(matchingVersion)
  )
    throw new Error('Invalid catalogue identity');
  if (
    owner.catalogue === catalogue &&
    owner.matchingVersion === matchingVersion
  )
    return false;
  if (
    owner.catalogue === catalogue ||
    owner.matchingVersion === matchingVersion
  )
    throw new Error('Catalogue and matching version must advance together');
  const head = await requireHead(ctx, owner._id);
  await ctx.db.patch('owners', owner._id, { catalogue, matchingVersion });
  await ctx.db.patch('ownerHeads', head._id, { catalogueAfter: '' });
  await ctx.scheduler.runAfter(0, internal.catalogue.next, {
    scope: {
      userId: owner.userId,
      athleteId: owner.athleteId,
      epoch: owner.epoch,
    },
    catalogue,
    writer: writerOf(owner),
  });
  return true;
}

/** Hide old matches immediately, then durably publish their invalidations. */
export const select = internalMutation({
  args: { scope: v.object(scopeFields), ...identity },
  handler: async (ctx, { scope, ...args }) =>
    // Selected by a copy from Postgres, for the catalogue Postgres matched
    // with.
    selectFor(ctx, await requireWritableOwner(ctx, scope), args),
});

/**
 * Move every library Convex writes to a catalogue: the newest complete
 * rowset under the deployed matching recipe, as `catalogueWorker.adopt`
 * names it. Each library's old matches are hidden at once and every
 * recording is matched again (`next`). Owners that already have the
 * catalogue are left alone, so this is safe to repeat. Returns how many
 * libraries were moved.
 */
export const adopt = internalMutation({
  args: {
    ...identity,
    cursor: v.optional(v.string()),
    moved: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, moved = 0, ...args }): Promise<number> => {
    const page = await ctx.db
      .query('owners')
      .paginate({ numItems: OWNER_PAGE, cursor: cursor ?? null });
    for (const owner of page.page)
      if (ingests(owner) && (await selectFor(ctx, owner, args))) moved++;
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.catalogue.adopt, {
        ...args,
        cursor: page.continueCursor,
        moved,
      });
    return moved;
  },
});

/**
 * Each transaction commits its cursor and schedules its continuation together.
 *
 * A continuation works for the writer it was scheduled under and checks it
 * in every transaction, like any other write to the library. When the writer
 * changes, queued continuations become no-ops and the cursor stays where it
 * is: nothing runs during a handoff, and `owners.setWriter` schedules the
 * rest for the store that writes next.
 *
 * For a library Convex writes, the walk also asks for each recording to be
 * matched against the new catalogue (`ingestion.requestMatch`), and pauses
 * between steps so the matches do not all start at once.
 */
export const next = internalMutation({
  args: {
    scope: v.object(scopeFields),
    catalogue: v.string(),
    /** Absent on work queued before owners had a writer: Postgres. */
    writer: v.optional(writerValidator),
  },
  handler: async (
    ctx,
    { scope, catalogue, writer = 'postgres' },
  ): Promise<{ done: boolean }> => {
    const owner = await ownerFor(ctx, scope.userId);
    // Revocation, handoff and a superseding catalogue make queued work a no-op.
    if (
      !owner ||
      owner.revoked ||
      writer === 'handoff' ||
      writerOf(owner) !== writer ||
      owner.backend !== 'convex' ||
      owner.epoch !== scope.epoch ||
      owner.athleteId !== scope.athleteId ||
      owner.catalogue !== catalogue
    )
      return { done: true };
    const head = await requireHead(ctx, owner._id);
    const after = head.catalogueAfter;
    if (after === undefined) return { done: true };
    const limit = WALK_PAGE;
    const rows = await ctx.db
      .query('activities')
      .withIndex('by_owner_live_key', (q) =>
        q
          .eq('owner', owner._id)
          .eq('generation', owner.generation)
          .eq('deleted', false)
          .gt('key', after),
      )
      .take(limit);
    let requested = 0;
    for (const row of rows) {
      if (!row.dto || row.projection?.match?.catalogue === catalogue) continue;
      if (row.projection?.match) {
        await ctx.db.patch('activities', row._id, {
          projection: { ...row.projection, match: undefined },
        });
        await publishChange(ctx, owner, row.dto.id, 'upsert');
      }
      if (
        writer === 'convex' &&
        row.recording &&
        row.projection?.streams?.state === 'current'
      ) {
        await requestMatch(ctx, owner._id, row.key);
        requested++;
      }
    }
    const done = rows.length < limit;
    await ctx.db.patch('ownerHeads', head._id, {
      catalogueAfter: done ? undefined : rows.at(-1)!.key,
    });
    if (!done)
      await ctx.scheduler.runAfter(
        requested > 0 ? REMATCH_PAUSE_MS : 0,
        internal.catalogue.next,
        {
          scope,
          catalogue,
          writer,
        },
      );
    return { done };
  },
});
