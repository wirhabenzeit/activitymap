import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
} from './_generated/server';
import { activityFor, publishChange } from './activityWrites';
import { ingests, requestMatch } from './ingestion';
import { writerValidator } from './ownerScope';
import {
  ownerFor,
  requireHead,
  requireWritableOwner,
  scopeFields,
  writerOf,
} from './owners';
import { latestCatalogue } from './places';

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
export async function selectFor(
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

/**
 * Move every library Convex writes to a catalogue: the latest one
 * (`places.latestCatalogue`: the live catalogue once it has been published)
 * under the deployed matching recipe, as `catalogueWorker.adopt` names it.
 * Each library's old matches are hidden at once and every recording is
 * matched again (`next`). Owners that already have the catalogue are left
 * alone, so this is safe to repeat. Returns how many libraries the first
 * page moved.
 *
 * Owners are moved a page at a time, so two adoptions can be under way at
 * once. Only the latest one may change owners: an adoption starts only for
 * the catalogue that is still the latest, records itself in
 * `catalogueAdoptions`, and each later page stops when another adoption has
 * been recorded since.
 */
export const adopt = internalMutation({
  args: {
    ...identity,
    /** The catalogue the identity was computed for. */
    snapshotId: v.string(),
    revision: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, ...args }): Promise<number> => {
    const { catalogue, matchingVersion } = args;
    const current = await ctx.db.query('catalogueAdoptions').first();
    if (cursor === undefined) {
      const latest = await latestCatalogue(ctx);
      if (
        latest?.snapshotId !== args.snapshotId ||
        latest.revision !== args.revision
      )
        return 0;
      const adoption = {
        catalogue,
        matchingVersion,
        snapshotId: args.snapshotId,
      };
      if (!current) await ctx.db.insert('catalogueAdoptions', adoption);
      else await ctx.db.patch('catalogueAdoptions', current._id, adoption);
    } else if (
      current?.catalogue !== catalogue ||
      current.matchingVersion !== matchingVersion
    )
      return 0;
    const page = await ctx.db
      .query('owners')
      .paginate({ numItems: OWNER_PAGE, cursor: cursor ?? null });
    let moved = 0;
    for (const owner of page.page)
      if (
        ingests(owner) &&
        (await selectFor(ctx, owner, { catalogue, matchingVersion }))
      )
        moved++;
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.catalogue.adopt, {
        ...args,
        cursor: page.continueCursor,
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

/** How many changed tiles one step of the re-match walk takes on. */
const TILE_PAGE = 64;

type TilePosition = { owner: Id<'owners'>; activity: string };

/** Up to `limit` activities whose match read `tile`, after `after`. */
async function tileActivities(
  ctx: QueryCtx,
  tile: string,
  after: TilePosition | undefined,
  limit: number,
) {
  const rows = after
    ? await ctx.db
        .query('activityPlaceTiles')
        .withIndex('by_tile_owner', (q) =>
          q
            .eq('tile', tile)
            .eq('owner', after.owner)
            .gt('activity', after.activity),
        )
        .take(limit)
    : [];
  if (rows.length < limit)
    rows.push(
      ...(await ctx.db
        .query('activityPlaceTiles')
        .withIndex('by_tile_owner', (q) =>
          after
            ? q.eq('tile', tile).gt('owner', after.owner)
            : q.eq('tile', tile),
        )
        .take(limit - rows.length)),
    );
  return rows;
}

/**
 * The re-match walk of a completed live catalogue revision
 * (livePlaces.completeApply schedules it): ask for a new match
 * (`ingestion.requestMatch`) of every activity whose match read a tile the
 * revision changed and started at an older revision. That includes matches
 * that ran while the revision was being applied. Old matches stay until the
 * new ones replace them. Owners Convex does not ingest for are skipped.
 *
 * The revision's `placeTileChanges` rows are the work left: a tile's row is
 * deleted once the walk has looked at all of its activities, and `cursor` is
 * the position within the first tile left. Each step looks at up to
 * `WALK_PAGE` activities and pauses like `next` when it asked for matches.
 * A second walk over the same tiles repeats only requests that change
 * nothing, and an activity in several tiles is matched once: a request for
 * a job already queued or running adds no run, and once it is matched its
 * revision is no longer older.
 */
export const rematchTiles = internalMutation({
  args: {
    revision: v.number(),
    /** Where the walk continues: the tile and the last activity seen in it. */
    cursor: v.optional(
      v.object({
        tile: v.string(),
        owner: v.id('owners'),
        activity: v.string(),
      }),
    ),
  },
  handler: async (ctx, { revision, cursor }): Promise<{ done: boolean }> => {
    const state = await ctx.db.query('placeCatalogueState').unique();
    // A pending revision's tiles wait for its completion.
    if (!state || state.revision < revision) return { done: true };
    const changes = await ctx.db
      .query('placeTileChanges')
      .withIndex('by_revision_tile', (q) => q.eq('revision', revision))
      .take(TILE_PAGE);
    const owners = new Map<Id<'owners'>, Doc<'owners'> | null>();
    const seen = new Set<string>();
    let budget = WALK_PAGE;
    let requested = 0;
    let next: typeof cursor;
    for (const change of changes) {
      const rows = await tileActivities(
        ctx,
        change.tile,
        cursor?.tile === change.tile ? cursor : undefined,
        budget,
      );
      for (const row of rows) {
        const key = `${row.owner}/${row.activity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!owners.has(row.owner))
          owners.set(row.owner, await ctx.db.get('owners', row.owner));
        const owner = owners.get(row.owner)!;
        if (!ingests(owner)) continue;
        const activity = await activityFor(ctx, owner._id, row.activity);
        const matchedAt = activity?.projection?.match?.revision ?? 0;
        if (
          activity?.dto &&
          !activity.deleted &&
          activity.generation === owner.generation &&
          activity.recording &&
          activity.projection?.streams?.state === 'current' &&
          matchedAt >= 1 &&
          matchedAt < revision
        ) {
          await requestMatch(ctx, owner._id, row.activity);
          requested++;
        }
      }
      budget -= rows.length;
      if (budget === 0) {
        const last = rows.at(-1)!;
        next = {
          tile: change.tile,
          owner: last.owner,
          activity: last.activity,
        };
        break;
      }
      await ctx.db.delete('placeTileChanges', change._id);
    }
    const done = !next && changes.length < TILE_PAGE;
    if (!done)
      await ctx.scheduler.runAfter(
        requested > 0 ? REMATCH_PAUSE_MS : 0,
        internal.catalogue.rematchTiles,
        { revision, ...(next && { cursor: next }) },
      );
    return { done };
  },
});
