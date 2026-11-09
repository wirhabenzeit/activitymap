import type { PhotoDTO } from '../../src/contracts/v1/photo';
import { photoDTOSchema } from '../../src/contracts/v1/photo';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { activityFor, publishChange } from './activityWrites';
import { idKey, requireOwner } from './owners';

/**
 * Photos are provider metadata (captions, sizes and CDN URLs), stored one
 * document per photo and keyed by the provider's `unique_id`. A photo belongs
 * to an activity; deleting the activity removes its photos without separate
 * change entries, because clients drop an activity's photos with it.
 *
 * Writers send the current photo set of an activity (`applyPhotoSet`), which
 * adds, updates and removes documents to match, or delete photos by ID when
 * the activity they belonged to is no longer known. Re-applying an unchanged
 * set changes no photo and publishes nothing.
 *
 * Each activity's set has a source revision (`photoSets`), recorded for empty
 * sets too. A writer with an older or equal revision is ignored as a whole,
 * so a stale set can neither replace nor delete what a newer one wrote.
 */

export const MAX_PHOTOS_PER_ACTIVITY = 200;

export function photoKey(value: string) {
  if (!value || value.length > 128) throw new Error('Invalid photo ID');
  return value;
}

function photosOf(
  ctx: QueryCtx,
  owner: Doc<'owners'>['_id'],
  activity: string,
) {
  return ctx.db
    .query('photos')
    .withIndex('by_owner_activity', (q) =>
      q.eq('owner', owner).eq('activity', activity),
    )
    .take(MAX_PHOTOS_PER_ACTIVITY + 1);
}

function setFor(ctx: QueryCtx, owner: Doc<'owners'>['_id'], activity: string) {
  return ctx.db
    .query('photoSets')
    .withIndex('by_owner_activity', (q) =>
      q.eq('owner', owner).eq('activity', activity),
    )
    .unique();
}

/** Structural equality that ignores key order (Convex sorts fields). */
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => same(item, right[index]))
    );
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  const a = Object.entries(left);
  const b = new Map(Object.entries(right));
  return (
    a.length === b.size && a.every(([key, item]) => same(item, b.get(key)))
  );
}

/** Make the stored photos of one activity equal `photos`. Returns how many
 * documents changed. Skipped (0) when the activity is not in the owner's
 * current library or the scope's generation is not current. */
export async function applyPhotoSet(
  ctx: MutationCtx,
  args: {
    scope: { userId: string; athleteId: string; epoch: string };
    generation: string;
    sourceRevision: number;
    activityId: string;
    photos: PhotoDTO[];
  },
) {
  const owner = await requireOwner(ctx, args.scope);
  if (owner.generation !== args.generation) return 0;
  if (!Number.isSafeInteger(args.sourceRevision) || args.sourceRevision < 1)
    throw new Error('Invalid source revision');
  if (args.photos.length > MAX_PHOTOS_PER_ACTIVITY)
    throw new Error('Too many photos for one activity');
  const activity = idKey(args.activityId);
  const row = await activityFor(ctx, owner._id, activity);
  if (!row || row.deleted || row.generation !== owner.generation) return 0;

  const next = new Map<string, PhotoDTO>();
  for (const item of args.photos) {
    const dto = photoDTOSchema.parse(item);
    if (
      dto.activity_id !== args.activityId ||
      dto.athlete_id !== owner.athleteId
    )
      throw new Error('Photo source owner mismatch');
    next.set(photoKey(dto.unique_id), dto);
  }
  const fence = await setFor(ctx, owner._id, activity);
  if (fence && args.sourceRevision <= fence.revision) return 0;
  if (fence)
    await ctx.db.patch('photoSets', fence._id, {
      revision: args.sourceRevision,
    });
  else
    await ctx.db.insert('photoSets', {
      owner: owner._id,
      activity,
      revision: args.sourceRevision,
    });

  let changed = 0;
  const stored = await photosOf(ctx, owner._id, activity);
  for (const doc of stored) {
    const dto = next.get(doc.key);
    if (!dto) {
      await ctx.db.delete('photos', doc._id);
      await publishChange(ctx, owner, doc.key, 'delete', 'photo');
      changed++;
      continue;
    }
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
    next.delete(doc.key);
    if (doc.generation === owner.generation && same(doc.dto, dto)) continue;
    await ctx.db.patch('photos', doc._id, {
      dto,
      generation: owner.generation,
      sourceRevision: args.sourceRevision,
    });
    await publishChange(ctx, owner, doc.key, 'upsert', 'photo');
    changed++;
  }
  for (const [key, dto] of next) {
    // The same photo ID under another activity moves here.
    const elsewhere = await ctx.db
      .query('photos')
      .withIndex('by_owner_key', (q) => q.eq('owner', owner._id).eq('key', key))
      .unique();
    if (elsewhere) await ctx.db.delete('photos', elsewhere._id);
    await ctx.db.insert('photos', {
      owner: owner._id,
      key,
      activity,
      generation: owner.generation,
      sourceRevision: args.sourceRevision,
      dto,
    });
    await publishChange(ctx, owner, key, 'upsert', 'photo');
    changed++;
  }
  return changed;
}

/** Delete photos by ID (their activity is unknown to the writer). */
export async function deletePhotoRecords(
  ctx: MutationCtx,
  args: {
    scope: { userId: string; athleteId: string; epoch: string };
    generation: string;
    sourceRevision: number;
    ids: string[];
  },
) {
  const owner = await requireOwner(ctx, args.scope);
  if (owner.generation !== args.generation) return 0;
  if (!Number.isSafeInteger(args.sourceRevision) || args.sourceRevision < 1)
    throw new Error('Invalid source revision');
  let deleted = 0;
  for (const id of args.ids) {
    const doc = await ctx.db
      .query('photos')
      .withIndex('by_owner_key', (q) =>
        q.eq('owner', owner._id).eq('key', photoKey(id)),
      )
      .unique();
    if (!doc) continue;
    // A newer set of its activity has already decided about this photo.
    const fence = await setFor(ctx, owner._id, doc.activity);
    if (fence && args.sourceRevision <= fence.revision) continue;
    await ctx.db.delete('photos', doc._id);
    await publishChange(ctx, owner, doc.key, 'delete', 'photo');
    deleted++;
  }
  return deleted;
}

/** Remove a deleted activity's photos. Clients drop them with the activity,
 * so no change entries are published. */
export async function removeActivityPhotos(
  ctx: MutationCtx,
  owner: Doc<'owners'>['_id'],
  activity: string,
) {
  for (const doc of await photosOf(ctx, owner, activity))
    await ctx.db.delete('photos', doc._id);
  // The deleted activity itself now refuses photo sets.
  const fence = await setFor(ctx, owner, activity);
  if (fence) await ctx.db.delete('photoSets', fence._id);
}

/** The owner's current photos after `after`, in photo-ID order. */
export async function photoPage(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  after: string | null,
  limit: number,
) {
  const rows = await ctx.db
    .query('photos')
    .withIndex('by_owner_live_key', (q) =>
      q
        .eq('owner', owner._id)
        .eq('generation', owner.generation)
        .gt('key', after ?? ''),
    )
    .take(limit);
  return rows.map((row) => row.dto);
}

/** The owner's current photos among `ids`; unknown IDs are left out. */
export async function photosByIds(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  ids: string[],
) {
  const rows = await Promise.all(
    ids.map((id) =>
      ctx.db
        .query('photos')
        .withIndex('by_owner_key', (q) =>
          q.eq('owner', owner._id).eq('key', photoKey(id)),
        )
        .unique(),
    ),
  );
  return rows.flatMap((row) =>
    row && row.generation === owner.generation ? [row.dto] : [],
  );
}
