import type { ActivityDTO } from '~/contracts/v1/activity';

import type { Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { PROJECTION_VERSION, projectedActivity } from './activityProjection';

/** The DTO clients see for a live activity row, or null when the row is not
 * part of the owner's current library. */
export function project(row: Doc<'activities'>, owner: Doc<'owners'>) {
  if (!row.dto || row.deleted || row.generation !== owner.generation)
    return null;
  if (
    row.projection?.version !== PROJECTION_VERSION ||
    row.projection.generation !== owner.generation
  ) {
    // Preserve the activity in the library while a projection is rebuilt.
    // Omit derived state rather than presenting stale streams or matches.
    return { ...row.dto };
  }
  return projectedActivity(
    row.dto,
    row.projection,
    owner,
    owner.matchingVersion,
  );
}

/** A row's recording only while it still describes the projected streams. */
export async function currentRecording(
  ctx: QueryCtx,
  row: Doc<'activities'>,
  item: Pick<Partial<ActivityDTO>, 'streams'>,
) {
  const recording =
    row.recording && (await ctx.db.get('recordings', row.recording));
  return recording &&
    recording.activity === row._id &&
    item.streams?.state === 'current' &&
    recording.sourceRevision === row.sourceRevision &&
    recording.generation === item.streams.generation &&
    recording.revision === item.streams.revision
    ? recording
    : null;
}

/** The owner's live activities after `after`, in activity-ID order. */
export function liveRows(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  after: string,
  count: number,
) {
  return ctx.db
    .query('activities')
    .withIndex('by_owner_live_key', (q) =>
      q
        .eq('owner', owner._id)
        .eq('generation', owner.generation)
        .eq('deleted', false)
        .gt('key', after),
    )
    .take(count);
}
