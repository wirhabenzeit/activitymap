import 'server-only';

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { z } from 'zod';

import type { BootstrapSnapshot } from '~/app/api/v1/sync/bootstrap/handler';
import type { ChangesSnapshot } from '~/app/api/v1/sync/changes/handler';
import { type ActivityDTO, activityDTOSchema } from '~/contracts/v1/activity';
import {
  type StreamMetadata,
  streamMetadataSchema,
} from '~/contracts/v1/activity-streams';
import { type PhotoDTO, photoDTOSchema } from '~/contracts/v1/photo';
import { syncChangeItemDTOSchema } from '~/contracts/v1/sync';
import { compactStreamSummarySchema } from '~/lib/streams/compact-summary';
import { placeMatchesFor } from '~/lib/sync/place-matches';
import { ActivityPlacesUnavailableError } from '~/server/application/match-activity-places';
import type { Actor } from '~/server/auth/actor';
import type { Activity, Photo } from '~/server/records';
import {
  ActivityStreamsUnavailableError,
  type StreamSummarySnapshot,
} from '~/server/repositories/activity-streams';
import { DEFAULT_RETENTION_DAYS } from '~/server/repositories/changes';
import { streamSummarySchema } from '~/server/strava/stream-summary';
import {
  ACTIVITY_STREAM_TYPES,
  rawActivityStreamsSchema,
} from '~/server/strava/streams';
import { warnBridgeFallback } from '~/server/sync/bridge-fallback-warning';
import { BridgeResponseError } from '~/server/sync/bridge-response-error';
import { convexSyncBridge } from '~/server/sync/convex-bridge';

import { convexIngestionStatus, statusPageSchema } from './status';

const maxBridgePage = 128;
const headSchema = z.object({
  sequence: z.number().int().nonnegative(),
  matchingVersion: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  lastSummaryReconciledAt: z.number().nullable(),
});
const bootstrapSchema = z.discriminatedUnion('resource', [
  z.object({
    resource: z.literal('activities'),
    head: headSchema,
    items: z.array(activityDTOSchema),
    more: z.boolean(),
  }),
  z.object({
    resource: z.literal('photos'),
    head: headSchema,
    items: z.array(photoDTOSchema),
    more: z.boolean(),
  }),
]);
const changeSchema = z.object({
  sequence: z.number().int().positive(),
  changedAt: z.number(),
  entityType: z.enum(['activity', 'photo']),
  entityId: z.string(),
  operation: z.enum(['upsert', 'delete']),
});
const changesSnapshotSchema = z.object({
  head: headSchema,
  items: z.array(syncChangeItemDTOSchema),
  lastSequence: z.number().int().nonnegative(),
});
const summariesSchema = z.array(
  z.object({
    activityId: z.string(),
    metadata: streamMetadataSchema.nullable(),
    summary: z
      .union([compactStreamSummarySchema, streamSummarySchema])
      .nullable(),
  }),
);

function date(value: string | null) {
  return value === null ? null : new Date(value);
}

function activityRow(
  dto: ActivityDTO,
): Activity & { streamsMetadata?: StreamMetadata } {
  return {
    ...dto,
    id: Number(dto.id),
    athlete: Number(dto.athlete),
    public_id: 0,
    upload_id: dto.upload_id === null ? null : Number(dto.upload_id),
    start_date: new Date(dto.start_date),
    start_date_local: new Date(dto.start_date_local),
    last_updated: date(dto.last_updated),
    geometryState: dto.geometry_state,
    photosState: dto.photos_state,
    lastSummarySeenAt: date(dto.last_summary_seen_at),
    lastDetailedFetchedAt: date(dto.last_detailed_fetched_at),
    is_complete: dto.geometry_state === 'detailed',
    streamsMetadata: dto.streams,
  };
}

function photoRow(dto: PhotoDTO): Photo {
  return {
    ...dto,
    activity_id: Number(dto.activity_id),
    athlete_id: Number(dto.athlete_id),
    uploaded_at: date(dto.uploaded_at),
    created_at: date(dto.created_at),
  };
}

function summaryRow(
  activityId: string,
  metadata: StreamMetadata | null,
  summary: StreamSummarySnapshot['summary'],
): StreamSummarySnapshot | null {
  if (!metadata?.generation || !metadata.fetched_at) return null;
  const fetchedAt = new Date(metadata.fetched_at);
  return {
    activityId,
    generation: metadata.generation,
    revision: metadata.revision,
    availableTypes: metadata.available_types,
    requestedTypes: [...ACTIVITY_STREAM_TYPES],
    fetchedAt,
    summary,
    invalidatedAt: metadata.state === 'stale' ? fetchedAt : null,
    lastAttemptAt: fetchedAt,
    lastAttemptStatus: metadata.state === 'stale' ? 'invalidated' : 'succeeded',
    lastError: null,
    nextRetryAt: null,
    attemptId: null,
    sourceVersion: null,
    leaseExpiresAt: null,
  };
}

type Operation = { kind: string; [field: string]: unknown };
type Transport = {
  /** Binds bootstrap continuation cursors to one backend, owner and epoch. */
  cursorBackend: string;
  /** Largest list page one call returns; a shorter page ends the list. */
  pageSize: number;
  summaryBatch: number;
  send: (operation: Operation) => Promise<Response>;
};

function scopeHash(parts: unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** `backend/` keeps 64-bit-safe string IDs and takes no retention cutoff. */
export function appOperation(operation: Operation): Operation {
  const id = (value: string | number | null) =>
    value === null ? null : String(value);
  switch (operation.kind) {
    case 'activities':
    case 'photos':
    case 'status':
      return {
        ...operation,
        after: id(operation.after as string | number | null),
      };
    case 'activityIds':
    case 'activityPhotos':
    case 'photoIds':
    case 'summaries':
      return {
        ...operation,
        ids: (operation.ids as (string | number)[]).map(String),
      };
    case 'raw':
      return { ...operation, id: String(operation.id) };
    case 'retention':
      return { kind: 'retention' };
    default:
      return operation;
  }
}

/** The application backend (`backend/`) through the signed sync bridge. Its
 * owner assignment check rejects an epoch that is not current for Convex. */
function appTransport(
  actor: Actor,
  epoch: string,
  fetcher: typeof fetch,
): Transport {
  const bridge = convexSyncBridge(actor, fetcher);
  if (!bridge)
    throw new Error('ACTIVITYMAP_CONVEX_SITE is required for library reads');
  return {
    cursorBackend: scopeHash([
      'app',
      process.env.ACTIVITYMAP_CONVEX_SITE,
      actor.userId,
      actor.athleteId,
      epoch,
    ]),
    // Mirrors the list and summary limits in backend/convex/sync.ts.
    pageSize: 32,
    summaryBatch: 48,
    send: (operation) => bridge.send(appOperation(operation), epoch),
  };
}

/** The application library adapter for an authenticated owner and its stored
 * Convex epoch. Transport selection never depends on migration allowlists. */
export function convexAppAdapter(
  actor: Actor,
  epoch: string,
  fetcher: typeof fetch = fetch,
) {
  return convexAdapter(actor, appTransport(actor, epoch, fetcher));
}

function convexAdapter(actor: Actor, transport: Transport) {
  const { userId, athleteId } = actor;
  const { cursorBackend, send, pageSize, summaryBatch } = transport;
  const query = async <T>(
    operation: { kind: string; [field: string]: unknown },
    schema: z.ZodType<T>,
  ) => schema.parse(await (await send(operation)).json());

  // Keep individual Convex calls below execution limits while honoring v1 page sizes.
  async function page<T, K>(
    limit: number,
    after: K,
    read: (after: K, limit: number) => Promise<T[]>,
    next: (row: T) => K,
    size = pageSize,
  ) {
    const all: T[] = [];
    while (all.length < limit) {
      const count = Math.min(size, limit - all.length);
      const rows = await read(after, count);
      all.push(...rows);
      if (rows.length < count) break;
      after = next(rows[rows.length - 1]!);
    }
    return all;
  }
  async function byIds<T, K>(
    ids: K[],
    read: (batch: K[]) => Promise<T[]>,
    batchSize = pageSize,
  ) {
    const batches: K[][] = [];
    for (let i = 0; i < ids.length; i += batchSize)
      batches.push(ids.slice(i, i + batchSize));
    const all: T[] = [];
    for (let i = 0; i < batches.length; i += 4) {
      all.push(
        ...(await Promise.all(batches.slice(i, i + 4).map(read))).flat(),
      );
    }
    return all;
  }

  const assertAthlete = (candidate: number) => {
    if (candidate !== athleteId) throw new Error('Convex athlete mismatch');
  };
  const assertActor = (candidate: Actor) => {
    if (candidate.userId !== userId) throw new Error('Convex actor mismatch');
    assertAthlete(candidate.athleteId);
  };
  let head: Promise<z.infer<typeof headSchema>> | undefined;
  const getHead = () => (head ??= query({ kind: 'head' }, headSchema));
  const getVersion = async () =>
    (await getHead()).matchingVersion ?? cursorBackend;
  const projected = new Map<string, ActivityDTO>();

  const captureActivities = (rows: ActivityDTO[]) =>
    rows.map((row) => {
      if (
        row.athlete !== String(athleteId) ||
        (row.placeMatches && row.placeMatches.userId !== userId)
      )
        throw new Error('Convex activity scope mismatch');
      projected.set(row.id, row);
      return activityRow(row);
    });
  const capturePhotos = (rows: PhotoDTO[]) =>
    rows.map((row) => {
      if (row.athlete_id !== String(athleteId))
        throw new Error('Convex photo scope mismatch');
      return photoRow(row);
    });
  const loadActivityIds = (ids: number[]) =>
    byIds(
      ids,
      (batch) =>
        query({ kind: 'activityIds', ids: batch }, z.array(activityDTOSchema)),
      8,
    );
  const matchFor = (row: ActivityDTO, version: string) =>
    placeMatchesFor(row, userId, version);

  return {
    cursorBackend,
    changesPage: async (
      candidate: Actor,
      args: { after: number; limit: number },
    ): Promise<ChangesSnapshot | null> => {
      assertActor(candidate);
      const result = await query(
        { kind: 'changesPage', ...args },
        changesSnapshotSchema,
      ).catch((error: unknown) => {
        // Older deployments reject the new operation with 400. The route
        // then uses the existing, fully fenced repository read path.
        if (error instanceof BridgeResponseError && error.status === 400) {
          warnBridgeFallback('changesPage');
          return null;
        }
        throw error;
      });
      if (result === null) return null;
      if (
        result.lastSequence < args.after ||
        result.lastSequence > result.head.sequence
      )
        throw new Error('Invalid changes snapshot sequence');
      const version = result.head.matchingVersion ?? cursorBackend;
      let previous = args.after;
      for (const item of result.items) {
        const sequence = Number(item.sequence);
        if (
          !Number.isSafeInteger(sequence) ||
          sequence <= previous ||
          sequence > result.lastSequence
        )
          throw new Error('Invalid changes snapshot order');
        previous = sequence;
        if (item.activity) {
          captureActivities([item.activity]);
          item.activity.placeMatches = matchFor(item.activity, version);
        }
        if (item.photo) capturePhotos([item.photo]);
      }
      return {
        items: result.items,
        lastSequence: result.lastSequence,
        freshness: {
          lastSummaryReconciledAt:
            result.head.lastSummaryReconciledAt === null
              ? null
              : new Date(result.head.lastSummaryReconciledAt).toISOString(),
          placeMatchingVersion: version,
        },
      };
    },
    bootstrapPage: async (
      candidate: Actor,
      args: {
        resource: 'activities' | 'photos';
        afterKey?: string;
        limit: number;
      },
    ): Promise<BootstrapSnapshot> => {
      assertActor(candidate);
      const result = await query(
        {
          kind: 'bootstrap',
          resource: args.resource,
          after: args.afterKey ?? null,
          limit: args.limit,
        },
        bootstrapSchema,
      );
      if (result.resource !== args.resource)
        throw new Error('Convex bootstrap resource mismatch');
      const version = result.head.matchingVersion ?? cursorBackend;
      if (result.resource === 'activities') captureActivities(result.items);
      else capturePhotos(result.items);
      return {
        sequence: result.head.sequence,
        lastSummaryReconciledAt:
          result.head.lastSummaryReconciledAt === null
            ? null
            : new Date(result.head.lastSummaryReconciledAt),
        matchingVersion: version,
        more: result.more,
        page:
          result.resource === 'activities'
            ? {
                resource: 'activities',
                items: result.items.map((row) => ({
                  ...row,
                  placeMatches: matchFor(row, version),
                })),
              }
            : { resource: 'photos', items: result.items },
      };
    },
    /** Activities among `ids` as bootstrap serves them, place matches
     * included. Missing and deleted activities are absent. */
    async activitiesByIds(ids: string[]): Promise<ActivityDTO[]> {
      const rows = await loadActivityIds(
        ids.map(Number).filter(Number.isSafeInteger),
      );
      captureActivities(rows);
      const version = await getVersion();
      return rows.map((row) => ({
        ...row,
        placeMatches: matchFor(row, version),
      }));
    },
    /** The photos of the activities among `ids` (application backend only). */
    async photosByActivities(ids: string[]): Promise<PhotoDTO[]> {
      const rows = await byIds(
        ids,
        (batch) =>
          query(
            { kind: 'activityPhotos', ids: batch },
            z.array(photoDTOSchema),
          ),
        16,
      );
      capturePhotos(rows);
      return rows;
    },
    activitiesRepo: {
      async findPageByAthlete(
        candidate: number,
        { afterId, limit }: { afterId?: number; limit: number },
      ) {
        assertAthlete(candidate);
        return captureActivities(
          await page(
            limit,
            afterId ?? null,
            (after, size) =>
              query(
                { kind: 'activities', after, limit: size },
                z.array(activityDTOSchema),
              ),
            (row) => Number(row.id),
          ),
        );
      },
      async findManyByIds(ids: number[]) {
        return captureActivities(
          await loadActivityIds(ids.filter(Number.isSafeInteger)),
        );
      },
    },
    photosRepo: {
      async findPageByAthlete(
        candidate: number,
        { afterId, limit }: { afterId?: string; limit: number },
      ) {
        assertAthlete(candidate);
        return capturePhotos(
          await page(
            limit,
            afterId ?? null,
            (after, size) =>
              query(
                { kind: 'photos', after, limit: size },
                z.array(photoDTOSchema),
              ),
            (row) => row.unique_id,
          ),
        );
      },
      async findManyByIds(ids: string[]) {
        return capturePhotos(
          await byIds(ids, (batch) =>
            query({ kind: 'photoIds', ids: batch }, z.array(photoDTOSchema)),
          ),
        );
      },
    },
    changesRepo: {
      async latestSequence(candidate: number) {
        assertAthlete(candidate);
        return (await getHead()).sequence;
      },
      async retentionFloor(observedAt: Date) {
        const cutoff =
          observedAt.getTime() - DEFAULT_RETENTION_DAYS * 86_400_000;
        return query(
          { kind: 'retention', cutoff },
          z.number().int().nonnegative(),
        );
      },
      async findAfter(
        candidate: number,
        sequence: number,
        { limit }: { limit: number },
      ) {
        assertAthlete(candidate);
        const rows = await page(
          Math.min(limit, maxBridgePage),
          sequence,
          (after, size) =>
            query(
              { kind: 'changes', after, limit: size },
              z.array(changeSchema),
            ),
          (row) => row.sequence,
          maxBridgePage,
        );
        return rows.map((row) => ({
          ...row,
          athleteId,
          changedAt: new Date(row.changedAt),
        }));
      },
    },
    freshnessRepo: {
      async lastCompletedAt(candidate: number) {
        assertAthlete(candidate);
        const { lastSummaryReconciledAt } = await getHead();
        return lastSummaryReconciledAt === null
          ? null
          : new Date(lastSummaryReconciledAt);
      },
    },
    placesRepo: {
      async sync(candidate: Actor, ids: string[]) {
        assertActor(candidate);
        const version = await getVersion();
        return {
          version,
          results: new Map(
            ids.flatMap((id) => {
              const row = projected.get(id);
              return row ? [[id, matchFor(row, version)]] : [];
            }),
          ),
        };
      },
      async read(candidate: Actor, id: string) {
        assertActor(candidate);
        if (!Number.isSafeInteger(Number(id)))
          throw new ActivityPlacesUnavailableError();
        captureActivities(await loadActivityIds([Number(id)]));
        const row = projected.get(id);
        if (!row) throw new ActivityPlacesUnavailableError();
        return matchFor(row, await getVersion());
      },
      async version(candidate: Actor) {
        assertActor(candidate);
        return { version: await getVersion() };
      },
    },
    streams: {
      async readSummaries(candidate: Actor, ids: string[]) {
        assertActor(candidate);
        const reads = await byIds(
          ids.map(Number).filter(Number.isSafeInteger),
          (batch) => query({ kind: 'summaries', ids: batch }, summariesSchema),
          summaryBatch,
        );
        return reads.map(({ activityId, metadata, summary }) => ({
          activityId,
          row: summaryRow(activityId, metadata, summary),
        }));
      },
      async read(candidate: Actor, id: string) {
        assertActor(candidate);
        if (!Number.isSafeInteger(Number(id)))
          throw new ActivityStreamsUnavailableError();
        const response = await send({ kind: 'raw', id: Number(id) });
        // Retain the historical header for compatibility with deployed bridges.
        const binaryMetadata =
          response.headers.get('x-stream-metadata') ??
          response.headers.get('x-preview-stream-metadata');
        if (binaryMetadata) {
          const metadata = streamMetadataSchema.parse(
            JSON.parse(binaryMetadata),
          );
          const raw = gunzipSync(new Uint8Array(await response.arrayBuffer()), {
            maxOutputLength: 64 * 1024 * 1024,
          });
          const row = summaryRow(id, metadata, null);
          if (!row) throw new Error('Convex stream metadata unavailable');
          return {
            ...row,
            payload: rawActivityStreamsSchema.parse(JSON.parse(raw.toString())),
          };
        }
        const read = z
          .object({ metadata: streamMetadataSchema.nullable() })
          .nullable()
          .parse(await response.json());
        if (!read) throw new ActivityStreamsUnavailableError();
        const row = summaryRow(id, read.metadata, null);
        return row ? { ...row, payload: null } : null;
      },
    },
    loadStatus: async (candidate: Actor, observedAt: Date) => {
      assertActor(candidate);
      // One read from the counts Convex keeps; while they are being rebuilt
      // (or on a backend without the operation) the library is walked.
      const summary = await query(
        { kind: 'statusSummary' },
        statusPageSchema.nullable(),
      ).catch(() => null);
      return convexIngestionStatus(
        (after) =>
          summary && after === null
            ? Promise.resolve(summary)
            : query({ kind: 'status', after }, statusPageSchema),
        observedAt,
      );
    },
  };
}
