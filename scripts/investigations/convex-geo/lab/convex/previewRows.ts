import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { previewFixtureActivity } from './previewFixture';
import { writeProjection } from './previewProjection';

export function activityFor(
  ctx: QueryCtx,
  owner: Id<'previewOwners'>,
  id: number,
) {
  return ctx.db
    .query('previewActivities')
    .withIndex('owner_activity', (q) => q.eq('owner', owner).eq('id', id))
    .unique();
}

export function photoFor(
  ctx: QueryCtx,
  owner: Id<'previewOwners'>,
  id: string,
) {
  return ctx.db
    .query('previewPhotos')
    .withIndex('owner_photo', (q) => q.eq('owner', owner).eq('id', id))
    .unique();
}

export function ownerForFixture(
  ctx: QueryCtx,
  account: Id<'ingestionAccounts'>,
) {
  return ctx.db
    .query('previewOwners')
    .withIndex('fixture_account', (q) => q.eq('fixtureAccount', account))
    .unique();
}

export async function recordPreviewChange(
  ctx: MutationCtx,
  owner: Id<'previewOwners'>,
  entityType: 'activity' | 'photo',
  entityId: string,
  operation: 'upsert' | 'delete',
) {
  const head = await ctx.db.get('previewOwners', owner);
  if (!head) throw new Error('Missing preview owner');
  if (entityType === 'activity' && operation === 'upsert') {
    const activity = await activityFor(ctx, owner, Number(entityId));
    if (!activity || head.erasing) throw new Error('Activity unavailable');
    await writeProjection(ctx, head, activity);
  }
  const sequence = head.sequence + 1;
  if (!Number.isSafeInteger(sequence))
    throw new Error('Preview feed exhausted');
  const changedAt = Math.max(head.lastChangedAt ?? 0, Date.now());
  await ctx.db.patch('previewOwners', owner, {
    sequence,
    lastChangedAt: changedAt,
  });
  await ctx.db.insert('previewChanges', {
    owner,
    sequence,
    entityType,
    entityId,
    operation,
    changedAt,
  });
}

export async function deletePreviewPhoto(
  ctx: MutationCtx,
  photo: Doc<'previewPhotos'>,
) {
  const activity = await activityFor(ctx, photo.owner, photo.activityId);
  if (activity)
    await ctx.db.patch('previewActivities', activity._id, {
      storedPhotos: Math.max(0, (activity.storedPhotos ?? 1) - 1),
    });
  await ctx.db.delete('previewPhotos', photo._id);
  await recordPreviewChange(ctx, photo.owner, 'photo', photo.id, 'delete');
}

export async function deletePreviewActivity(
  ctx: MutationCtx,
  activity: Doc<'previewActivities'>,
) {
  const photos = await ctx.db
    .query('previewPhotos')
    .withIndex('owner_activity', (q) =>
      q.eq('owner', activity.owner).eq('activityId', activity.id),
    )
    .collect();
  for (const photo of photos) await deletePreviewPhoto(ctx, photo);
  await ctx.db.delete('previewActivities', activity._id);
  await recordPreviewChange(
    ctx,
    activity.owner,
    'activity',
    String(activity.id),
    'delete',
  );
}

export async function updateFixturePreview(
  ctx: MutationCtx,
  account: Id<'ingestionAccounts'>,
  key: string,
  update:
    { target: Id<'recordingTargets'>; name: string } | 'delete' | 'invalidate',
) {
  const owner = await ownerForFixture(ctx, account);
  const id = Number(key);
  if (!owner || owner.erasing || !Number.isSafeInteger(id)) return;
  const activity = await activityFor(ctx, owner._id, id);
  if (!activity) {
    if (typeof update === 'string') return;
    await ctx.db.insert('previewActivities', {
      owner: owner._id,
      id,
      dto: previewFixtureActivity(
        key,
        String(owner.athleteId),
        update.name,
        Date.now(),
      ),
      target: update.target,
    });
    await recordPreviewChange(ctx, owner._id, 'activity', key, 'upsert');
    return;
  }
  if (update === 'delete') {
    await deletePreviewActivity(ctx, activity);
    return;
  }
  if (update !== 'invalidate') {
    await ctx.db.patch('previewActivities', activity._id, {
      target: update.target,
      dto: { ...activity.dto, name: update.name },
    });
  }
  await recordPreviewChange(ctx, owner._id, 'activity', key, 'upsert');
}

export async function publishFixturePreviewMatch(
  ctx: MutationCtx,
  target: Id<'recordingTargets'>,
) {
  const activity = await ctx.db
    .query('previewActivities')
    .withIndex('target', (q) => q.eq('target', target))
    .unique();
  if (activity && !(await ctx.db.get('previewOwners', activity.owner))?.erasing)
    await recordPreviewChange(
      ctx,
      activity.owner,
      'activity',
      String(activity.id),
      'upsert',
    );
}
