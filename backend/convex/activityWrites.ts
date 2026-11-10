import { type ObjectType, v } from 'convex/values';

import { activityPlacesResponseSchema } from '../../src/contracts/activity-places';
import { activityDTOSchema } from '../../src/contracts/v1/activity';
import { streamMetadataSchema } from '../../src/contracts/v1/activity-streams';
import { STREAM_SOURCE_FIELDS } from '../../src/server/strava/stream-policy';
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
import { idKey, requireHead, requireOwner, scopeFields } from './owners';
import { removeActivityPhotos } from './photos';
import { manifestValidator, summaryValidator } from './recordingValidators';
import { applyStats, contribution } from './stats';

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
  entityType: 'activity' | 'photo' = 'activity',
) {
  const head = await requireHead(ctx, owner._id);
  const sequence = head.sequence + 1;
  if (!Number.isSafeInteger(sequence)) throw new Error('Change feed exhausted');
  await ctx.db.patch('ownerHeads', head._id, { sequence });

  await ctx.db.insert('changes', {
    owner: owner._id,
    sequence,
    entityId,
    operation,
    entityType,
    changedAt: Date.now(),
  });
}

/** The provider coordinator supplies a locally assigned, monotonic source revision. */
const applySourceArgs = {
  ...fence,
  dto: v.union(activityMetadataValidator, v.null()),
};

/** Shared by the mutation and batched trusted writers such as the importer. */
export async function applySourceRecord(
  ctx: MutationCtx,
  args: ObjectType<typeof applySourceArgs>,
) {
  const owner = await requireOwner(ctx, args.scope);
  const key = idKey(args.id);
  if (owner.generation !== args.generation) return false;
  if (!Number.isSafeInteger(args.sourceRevision) || args.sourceRevision < 1)
    throw new Error('Invalid source revision');
  const prior = await activityFor(ctx, owner._id, key);
  if (
    !supersedes(
      { version: args.sourceRevision, deleted: args.dto === null },
      prior ? { version: prior.sourceRevision, deleted: prior.deleted } : null,
    )
  )
    return false;
  // Match the Postgres stream-source trigger: social/label changes cannot
  // invalidate sensor samples, but privacy, geometry and sensor changes can.
  const preserve = !!(
    args.dto &&
    prior?.dto &&
    !prior.deleted &&
    prior.generation === args.generation &&
    prior.projection?.generation === args.generation &&
    prior.projection.version === PROJECTION_VERSION &&
    STREAM_SOURCE_FIELDS.every(
      (field) =>
        JSON.stringify(prior.dto![field]) === JSON.stringify(args.dto![field]),
    )
  );
  // Counted before the old recording can be deleted below.
  const countedBefore = await contribution(ctx, owner, prior);
  const oldRecording =
    prior?.recording && (await ctx.db.get('recordings', prior.recording));
  if (oldRecording && !preserve) {
    await ctx.storage.delete(oldRecording.file);
    await ctx.db.delete('recordings', oldRecording._id);
  }
  const common = {
    owner: owner._id,
    key,
    sourceRevision: args.sourceRevision,
    // Stable across metadata changes, advances on source changes/deletion.
    // Unlike a value hash, this also fences changes that are later reverted.
    streamSourceRevision: preserve
      ? prior!.streamSourceRevision
      : args.sourceRevision,
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
    await removeActivityPhotos(ctx, owner._id, key);
    await applyStats(ctx, owner._id, key, countedBefore, null);
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
    ...(preserve && { match: prior?.projection?.match }),
    ...(previousStreams && {
      streams: {
        ...previousStreams,
        ...(!preserve && {
          state: 'stale' as const,
          fetch_status: 'invalidated' as const,
        }),
      },
    }),
  });
  if (preserve && oldRecording)
    await ctx.db.patch('recordings', oldRecording._id, {
      sourceRevision: args.sourceRevision,
    });
  const next = {
    ...common,
    dto,
    projection,
    deleted: false,
    ...(preserve && prior?.recording && { recording: prior.recording }),
  };
  if (prior) await ctx.db.replace('activities', prior._id, next);
  else await ctx.db.insert('activities', next);
  // Re-applying identical metadata (mirror replays, importer re-runs) only
  // advances the revision fence; clients have nothing new to sync.
  if (!(preserve && sameValue(prior!.dto, dto)))
    await publishChange(ctx, owner, args.id, 'upsert');
  await applyStats(
    ctx,
    owner._id,
    key,
    countedBefore,
    await contribution(ctx, owner, await activityFor(ctx, owner._id, key)),
  );
  return true;
}

/** Structural equality that ignores object key order (Convex sorts fields). */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  const entries = (value: object) =>
    Object.entries(value).filter(([, item]) => item !== undefined);
  const a = entries(left);
  const b = new Map(entries(right));
  return (
    a.length === b.size && a.every(([key, item]) => sameValue(item, b.get(key)))
  );
}

export const applySource = internalMutation({
  args: applySourceArgs,
  handler: applySourceRecord,
});

/** Stream revisions are decimal counters assigned by the stream store. */
function newerRevision(candidate: string, current: string) {
  const decimal = /^(0|[1-9][0-9]*)$/;
  return (
    decimal.test(candidate) &&
    decimal.test(current) &&
    BigInt(candidate) > BigInt(current)
  );
}

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
    row.generation !== owner.generation ||
    row.projection?.version !== PROJECTION_VERSION ||
    row.projection.generation !== owner.generation
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
    if (
      !scope ||
      !Number.isSafeInteger(args.sourceRevision) ||
      args.sourceRevision < scope.row.streamSourceRevision ||
      args.sourceRevision > scope.row.sourceRevision
    )
      return false;
    const { owner, row, dto, projection } = scope;
    const countedBefore = await contribution(ctx, owner, row);
    const streams = streamMetadataSchema.parse(args.metadata);
    if (
      !streams.generation ||
      streams.state !== 'current' ||
      streams.fetch_status !== 'succeeded'
    )
      throw new Error('Invalid recording metadata');
    // A refresh of the same stream source replaces the current recording only
    // with a strictly newer revision, so late or repeated fetches cannot win.
    const prior =
      row.recording && (await ctx.db.get('recordings', row.recording));
    if (prior && !newerRevision(streams.revision, prior.revision)) return false;
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
      sourceRevision: row.sourceRevision,
      manifest: args.manifest,
      summary: args.summary,
    });
    await ctx.db.patch('activities', row._id, {
      recording,
      // Matches belong to the samples they were computed from.
      projection: boundedProjection(dto, {
        ...projection,
        streams,
        match: undefined,
      }),
    });
    if (prior) {
      await ctx.storage.delete(prior.file);
      await ctx.db.delete('recordings', prior._id);
    }
    await publishChange(ctx, owner, args.id, 'upsert');
    await applyStats(
      ctx,
      owner._id,
      row.key,
      countedBefore,
      await contribution(ctx, owner, await ctx.db.get('activities', row._id)),
    );
    return true;
  },
});

const publishMatchArgs = {
  ...fence,
  recording: v.id('recordings'),
  catalogue: v.string(),
  result: placeMatchValidator,
};

export async function publishMatchRecord(
  ctx: MutationCtx,
  args: ObjectType<typeof publishMatchArgs>,
) {
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
  const head = await requireHead(ctx, owner._id);
  await ctx.db.patch('activities', row._id, {
    projection: boundedProjection(dto, {
      ...projection,
      match: {
        catalogue: args.catalogue,
        value: { ...result, resultRevision: String(head.sequence + 1) },
      },
    }),
  });
  await publishChange(ctx, owner, args.id, 'upsert');
  return true;
}

export const publishMatch = internalMutation({
  args: publishMatchArgs,
  handler: publishMatchRecord,
});
