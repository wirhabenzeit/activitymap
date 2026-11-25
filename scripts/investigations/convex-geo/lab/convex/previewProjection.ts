import type { StreamMetadata } from '~/contracts/v1/activity-streams';

import {
  PROJECTION_VERSION,
  boundedProjection,
  jsonBytes,
  projectedActivity,
} from '../../../../../backend/convex/activityProjection';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

export async function projectionSource(
  ctx: QueryCtx,
  owner: Doc<'previewOwners'>,
) {
  const [account, retained, run] = await Promise.all([
    owner.fixtureAccount
      ? ctx.db.get('ingestionAccounts', owner.fixtureAccount)
      : null,
    owner.retainedOwner
      ? ctx.db.get('matchingOwners', owner.retainedOwner)
      : null,
    owner.retainedRun ? ctx.db.get('matchingRuns', owner.retainedRun) : null,
  ]);
  return {
    owner: account?._id ?? retained?._id,
    generation: account ? String(account.generation) : retained?.generation,
    revoked: account?.state === 'revoked',
    catalogue: account?.matchingCatalogue ?? run?.catalogue,
    resultUserId: account?._id ?? retained?.userId,
    matchingOwner: retained?._id,
  };
}
export type ProjectionSource = Awaited<ReturnType<typeof projectionSource>>;

export async function streamState(
  ctx: QueryCtx,
  owner: Doc<'previewOwners'>,
  activity: Doc<'previewActivities'>,
  source?: ProjectionSource,
) {
  if (!activity.target || (!owner.fixtureAccount && !owner.retainedOwner))
    return null;
  const [target, binding] = await Promise.all([
    ctx.db.get('recordingTargets', activity.target),
    source ?? projectionSource(ctx, owner),
  ]);
  if (
    !target?.current ||
    binding.revoked ||
    !binding.owner ||
    target.owner !== binding.owner ||
    target.key !== String(activity.id) ||
    target.accountGeneration !== binding.generation
  )
    return null;
  const manifest = await ctx.db.get('recordingManifests', target.current);
  if (
    !manifest ||
    manifest.owner !== target.owner ||
    manifest.key !== target.key ||
    manifest.generation !== target.generation ||
    manifest.accountGeneration !== target.accountGeneration
  )
    return null;
  return {
    target,
    manifest,
    current: manifest.sourceVersion === target.sourceVersion,
  };
}

export function metadata(
  state: NonNullable<Awaited<ReturnType<typeof streamState>>>,
) {
  return {
    generation: state.manifest.generation,
    revision: String(state.manifest.revision),
    state: state.current ? ('current' as const) : ('stale' as const),
    fetch_status: state.current
      ? ('succeeded' as const)
      : ('invalidated' as const),
    available_types: Object.keys(
      state.manifest.manifest.counts,
    ) as StreamMetadata['available_types'],
    fetched_at: new Date(state.manifest._creationTime).toISOString(),
    expires_at: null,
  };
}

export async function buildProjection(
  ctx: QueryCtx,
  owner: Doc<'previewOwners'>,
  row: Doc<'previewActivities'>,
  source: ProjectionSource,
) {
  const [state, check] = await Promise.all([
    streamState(ctx, owner, row, source),
    row.target
      ? ctx.db
          .query('placeChecks')
          .withIndex('target', (q) => q.eq('target', row.target!))
          .unique()
      : null,
  ]);
  let placeMatches = undefined;
  if (state?.current) {
    if (
      check?.accountGeneration === source.generation &&
      check?.recording === state.manifest._id &&
      check.catalogue === source.catalogue &&
      check.result.userId === source.resultUserId &&
      (!source.matchingOwner || check.owner === source.matchingOwner) &&
      check.sourceVersion === state.manifest.sourceVersion &&
      check.recordingGeneration === state.manifest.generation &&
      check.recordingRevision === state.manifest.revision
    ) {
      placeMatches = {
        ...check.result,
        userId: owner.userId,
        matchingVersion: owner.matchingVersion,
        resultRevision: String(check.sequence),
      };
    }
  }
  return boundedProjection(row.dto, {
    version: PROJECTION_VERSION,
    ...(state && {
      generation: state.manifest.accountGeneration,
      sourceVersion: state.target.sourceVersion,
      streams: metadata(state),
    }),
    ...(placeMatches &&
      check && {
        match: {
          catalogue: check.catalogue,
          value: placeMatches,
        },
      }),
  });
}

export async function projectActivity(
  ctx: QueryCtx,
  owner: Doc<'previewOwners'>,
  row: Doc<'previewActivities'>,
  source: ProjectionSource,
) {
  const projection =
    owner.projectionVersion === PROJECTION_VERSION
      ? row.projection
      : await buildProjection(ctx, owner, row, source);
  if (projection?.version !== PROJECTION_VERSION)
    throw new Error('Activity projection unavailable');
  return projectedActivity(row.dto, projection, source, owner.matchingVersion);
}

export async function writeProjection(
  ctx: MutationCtx,
  owner: Doc<'previewOwners'>,
  row: Doc<'previewActivities'>,
  source?: ProjectionSource,
) {
  const projection = await buildProjection(
    ctx,
    owner,
    row,
    source ?? (await projectionSource(ctx, owner)),
  );
  await ctx.db.patch('previewActivities', row._id, { projection });
  return jsonBytes(projection);
}
