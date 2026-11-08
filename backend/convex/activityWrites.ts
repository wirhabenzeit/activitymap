import { v } from 'convex/values';

import { activityPlacesResponseSchema } from '../../src/contracts/activity-places';
import { activityDTOSchema } from '../../src/contracts/v1/activity';
import { streamMetadataSchema } from '../../src/contracts/v1/activity-streams';
import { supersedes } from '../ingestion/source-order';
import type { Doc } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
} from './_generated/server';
import {
  PROJECTION_VERSION,
  boundedProjection,
  jsonBytes,
} from './activityProjection';
import {
  activityMetadataValidator,
  placeMatchValidator,
  streamMetadataValidator,
} from './activityValidators';
import { idKey, requireOwner, scopeFields } from './owners';
import { manifestValidator, summaryValidator } from './recordingValidators';

const fence = {
  scope: v.object(scopeFields),
  id: v.string(),
  generation: v.string(),
  sourceRevision: v.number(),
};

export function activityFor(
  ctx: QueryCtx,
  owner: Doc<'owners'>['_id'],
  key: string,
) {
  return ctx.db
    .query('activities')
    .withIndex('by_owner_key', (q) => q.eq('owner', owner).eq('key', key))
    .unique();
}

export async function publishChange(
  ctx: MutationCtx,
  owner: Doc<'owners'>,
  entityId: string,
  operation: 'upsert' | 'delete',
) {
  const sequence = owner.sequence + 1;
  if (!Number.isSafeInteger(sequence)) throw new Error('Change feed exhausted');
  await ctx.db.patch('owners', owner._id, { sequence });

  await ctx.db.insert('changes', {
    owner: owner._id,
    sequence,
    entityId,
    operation,
    entityType: 'activity',
    changedAt: Date.now(),
  });
}

/** The provider coordinator supplies a locally assigned, monotonic source revision. */
export const applySource = internalMutation({
  args: { ...fence, dto: v.union(activityMetadataValidator, v.null()) },
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx, args.scope);
    const key = idKey(args.id);
    if (owner.generation !== args.generation) return false;
    if (!Number.isSafeInteger(args.sourceRevision) || args.sourceRevision < 1)
      throw new Error('Invalid source revision');
    const prior = await activityFor(ctx, owner._id, key);
    if (
      !supersedes(
        { version: args.sourceRevision, deleted: args.dto === null },
        prior
          ? { version: prior.sourceRevision, deleted: prior.deleted }
          : null,
      )
    )
      return false;
    const oldRecording =
      prior?.recording && (await ctx.db.get('recordings', prior.recording));
    if (oldRecording) {
      await ctx.storage.delete(oldRecording.file);
      await ctx.db.delete('recordings', oldRecording._id);
    }
    const common = {
      owner: owner._id,
      key,
      sourceRevision: args.sourceRevision,
      generation: args.generation,
    };
    if (args.dto === null) {
      const next = {
        ...common,
        deleted: true,
        dto: undefined,
        projection: undefined,
        recording: undefined,
      };
      if (prior) await ctx.db.replace('activities', prior._id, next);
      else await ctx.db.insert('activities', next);
      if (prior && !prior.deleted)
        await publishChange(ctx, owner, args.id, 'delete');
      return true;
    }
    const {
      streams: _streams,
      placeMatches: _matches,
      ...dto
    } = activityDTOSchema.parse(args.dto);
    if (dto.id !== args.id || dto.athlete !== owner.athleteId)
      throw new Error('Activity source owner mismatch');
    const previousStreams =
      prior?.generation === owner.generation
        ? prior.projection?.streams
        : undefined;
    const projection = boundedProjection(dto, {
      version: PROJECTION_VERSION,
      generation: owner.generation,
      sourceVersion: String(args.sourceRevision),
      ...(previousStreams && {
        streams: {
          ...previousStreams,
          state: 'stale',
          fetch_status: 'invalidated',
        },
      }),
    });
    const next = { ...common, dto, projection, deleted: false };
    if (prior) await ctx.db.replace('activities', prior._id, next);
    else await ctx.db.insert('activities', next);
    await publishChange(ctx, owner, args.id, 'upsert');
    return true;
  },
});

async function publicationScope(
  ctx: QueryCtx,
  args: {
    scope: { userId: string; athleteId: string; epoch: string };
    id: string;
    generation: string;
    sourceRevision: number;
  },
) {
  const owner = await requireOwner(ctx, args.scope);
  if (owner.generation !== args.generation) return null;
  const row = await activityFor(ctx, owner._id, idKey(args.id));
  if (
    !row?.dto ||
    row.deleted ||
    row.sourceRevision !== args.sourceRevision ||
    row.generation !== owner.generation ||
    row.projection?.version !== PROJECTION_VERSION
  )
    return null;
  return { owner, row, dto: row.dto, projection: row.projection };
}

export const publishRecording = internalMutation({
  args: {
    ...fence,
    file: v.id('_storage'),
    compressedHash: v.string(),
    manifest: manifestValidator,
    summary: summaryValidator,
    metadata: streamMetadataValidator,
  },
  handler: async (ctx, args) => {
    const scope = await publicationScope(ctx, args);
    if (!scope || scope.row.recording) return false;
    const { owner, row, dto, projection } = scope;
    const streams = streamMetadataSchema.parse(args.metadata);
    if (
      !streams.generation ||
      streams.state !== 'current' ||
      streams.fetch_status !== 'succeeded'
    )
      throw new Error('Invalid recording metadata');
    const [file, existing] = await Promise.all([
      ctx.db.system.get('_storage', args.file),
      ctx.db
        .query('recordings')
        .withIndex('by_file', (q) => q.eq('file', args.file))
        .unique(),
    ]);
    const maxRecordingBytes = 64 * 1024 * 1024;
    if (
      !file ||
      existing ||
      file.sha256 !== args.compressedHash ||
      file.size !== args.manifest.compressedBytes ||
      file.size > maxRecordingBytes ||
      !Number.isSafeInteger(args.manifest.uncompressedBytes) ||
      args.manifest.uncompressedBytes < 1 ||
      args.manifest.uncompressedBytes > maxRecordingBytes ||
      !/^[0-9a-f]{64}$/.test(args.manifest.contentHash) ||
      Object.values(args.manifest.counts).some(
        (count) => !Number.isSafeInteger(count) || count < 0,
      ) ||
      jsonBytes(args.summary) > 32 * 1024
    )
      throw new Error('Invalid recording publication');
    const recording = await ctx.db.insert('recordings', {
      activity: row._id,
      file: args.file,
      generation: streams.generation,
      revision: streams.revision,
      sourceRevision: args.sourceRevision,
      manifest: args.manifest,
      summary: args.summary,
    });
    await ctx.db.patch('activities', row._id, {
      recording,
      projection: boundedProjection(dto, {
        ...projection,
        streams,
        match: undefined,
      }),
    });
    await publishChange(ctx, owner, args.id, 'upsert');
    return true;
  },
});

export const publishMatch = internalMutation({
  args: {
    ...fence,
    recording: v.id('recordings'),
    catalogue: v.string(),
    result: placeMatchValidator,
  },
  handler: async (ctx, args) => {
    const scope = await publicationScope(ctx, args);
    if (
      !scope ||
      scope.row.recording !== args.recording ||
      scope.owner.catalogue !== args.catalogue
    )
      return false;
    const { owner, row, dto, projection } = scope;
    const result = activityPlacesResponseSchema.parse(args.result);
    if (
      result.activityId !== args.id ||
      result.userId !== owner.userId ||
      result.streamGeneration !== projection.streams?.generation ||
      result.streamRevision !== projection.streams?.revision
    )
      throw new Error('Matching result source mismatch');
    const prior = projection.match;
    if (prior?.catalogue === args.catalogue) return false;
    await ctx.db.patch('activities', row._id, {
      projection: boundedProjection(dto, {
        ...projection,
        match: {
          catalogue: args.catalogue,
          value: { ...result, resultRevision: String(owner.sequence + 1) },
        },
      }),
    });
    await publishChange(ctx, owner, args.id, 'upsert');
    return true;
  },
});
