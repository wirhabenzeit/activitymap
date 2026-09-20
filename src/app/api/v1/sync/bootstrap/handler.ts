import { randomUUID } from 'node:crypto';

import type { Actor } from '~/server/auth/actor';
import { toActivityDTO } from '~/contracts/v1/activity';
import { toPhotoDTO } from '~/contracts/v1/photo';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  syncBootstrapPageDTOSchema,
  syncBootstrapQuerySchema,
} from '~/contracts/v1/sync';
import { encodeSyncCursor } from '~/server/sync/cursor';
import {
  encodeBootstrapCursor,
  tryDecodeBootstrapCursor,
} from '~/server/sync/bootstrap-cursor';
import type { ActivitiesRepository } from '~/server/repositories/activities';
import type { PhotosRepository } from '~/server/repositories/photos';
import type { ChangesRepository } from '~/server/repositories/changes';
import { DEFAULT_RETENTION_DAYS } from '~/server/repositories/changes';

export interface SyncBootstrapHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /** Resolves the authenticated Actor for a request, or `null` if unauthenticated. Wired in `route.ts` via `~/server/auth/actor.ts`'s `resolveActor`. */
  resolveActor: (request: Request) => Promise<Actor | null>;
  activitiesRepo: Pick<ActivitiesRepository, 'findPageByAthlete'>;
  photosRepo: Pick<PhotosRepository, 'findPageByAthlete'>;
  changesRepo: Pick<ChangesRepository, 'latestSequence'>;
  /** Overridable only for tests; production always uses `DEFAULT_RETENTION_DAYS`. */
  retentionDays?: number;
}

function requestIdFor(request: Request, createRequestId: () => string): string {
  const suppliedRequestId = request.headers.get('x-request-id')?.trim();
  if (suppliedRequestId) return suppliedRequestId;
  return createRequestId();
}

/**
 * Build the `GET /api/v1/sync/bootstrap` Route Handler (issue #123): a
 * stable keyset-paginated snapshot of the caller's activities or photos,
 * for a native client populating a fresh local SQLite store.
 *
 * Call shape: the client pages through `resource=activities` (the default)
 * until `nextCursor` is `null`, then repeats with `resource=photos`. The
 * very first request of a bootstrap run - `resource=activities` with no
 * `cursor` - captures and returns `snapshotCursor`, the change-feed
 * high-water mark at the moment bootstrap begins (never recomputed on later
 * pages, so it cannot silently drift forward and miss a concurrent
 * mutation). Once every page of both resources has been applied to local
 * storage, the client calls `/api/v1/sync/changes?cursor=<snapshotCursor>`
 * to pick up anything that changed while bootstrap was running - see
 * docs/swiftui-backend-preparation-plan.md, "Synchronization protocol".
 */
export function createSyncBootstrapHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  resolveActor,
  activitiesRepo,
  photosRepo,
  changesRepo,
  retentionDays = DEFAULT_RETENTION_DAYS,
}: SyncBootstrapHandlerDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);

    try {
      const actor = await resolveActor(request);
      if (!actor) {
        return Response.json(
          errorEnvelope('not_authenticated', 'Authentication is required.', {
            requestId,
          }),
          { status: 401 },
        );
      }

      const url = new URL(request.url);
      const parsedQuery = syncBootstrapQuerySchema.safeParse({
        resource: url.searchParams.get('resource') ?? undefined,
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      });
      if (!parsedQuery.success) {
        return Response.json(
          errorEnvelope('validation_failed', 'The query parameters are invalid.', {
            requestId,
            details: parsedQuery.error.flatten(),
          }),
          { status: 400 },
        );
      }

      const { resource, cursor, limit } = parsedQuery.data;
      // The client-documented start of a whole bootstrap run is
      // `resource=activities` with no `cursor` (see this handler's own doc
      // comment). Only that exact request captures `snapshotCursor` - a
      // `resource=photos` first page must NOT also mint one: if it did, it
      // would be a later (or, under concurrent writes, only ever
      // non-decreasing but still wrong) high-water mark than the one
      // captured when activities pagination began, and reusing it would
      // silently drop any change that landed on an activity in between.
      const isFirstPage = resource === 'activities' && cursor === undefined;

      let afterKey: string | undefined;
      if (cursor !== undefined) {
        const decoded = tryDecodeBootstrapCursor(cursor);
        if (decoded === null) {
          return Response.json(
            errorEnvelope('validation_failed', 'The `cursor` parameter is invalid.', {
              requestId,
            }),
            { status: 400 },
          );
        }
        afterKey = decoded;
      }

      if (
        resource === 'activities' &&
        afterKey !== undefined &&
        !Number.isInteger(Number(afterKey))
      ) {
        return Response.json(
          errorEnvelope('validation_failed', 'The `cursor` parameter is invalid.', {
            requestId,
          }),
          { status: 400 },
        );
      }

      const nowValue = now();
      const snapshotCursor = isFirstPage
        ? encodeSyncCursor(await changesRepo.latestSequence(actor.athleteId))
        : null;
      const retention = {
        retentionDays,
        cursorValidUntil: new Date(
          nowValue.getTime() + retentionDays * 24 * 60 * 60 * 1000,
        ).toISOString(),
      };

      const payload =
        resource === 'activities'
          ? await buildActivitiesPage({
              activitiesRepo,
              athleteId: actor.athleteId,
              afterKey,
              limit,
              snapshotCursor,
              retention,
            })
          : await buildPhotosPage({
              photosRepo,
              athleteId: actor.athleteId,
              afterKey,
              limit,
              snapshotCursor,
              retention,
            });

      const body = responseEnvelope(syncBootstrapPageDTOSchema).parse(
        makeEnvelope(payload, nowValue),
      );
      return Response.json(body);
    } catch (error) {
      onError(error, requestId);
      return Response.json(
        errorEnvelope('internal_error', 'The request could not be completed.', {
          requestId,
          retryable: true,
        }),
        { status: 500 },
      );
    }
  };
}

type RetentionMeta = { retentionDays: number; cursorValidUntil: string };

async function buildActivitiesPage({
  activitiesRepo,
  athleteId,
  afterKey,
  limit,
  snapshotCursor,
  retention,
}: {
  activitiesRepo: Pick<ActivitiesRepository, 'findPageByAthlete'>;
  athleteId: number;
  afterKey: string | undefined;
  limit: number;
  snapshotCursor: string | null;
  retention: RetentionMeta;
}) {
  const afterId = afterKey === undefined ? undefined : Number(afterKey);
  if (afterId !== undefined && !Number.isInteger(afterId)) {
    throw new Error('Decoded bootstrap cursor is not a valid activity id');
  }

  const rows = await activitiesRepo.findPageByAthlete(athleteId, {
    afterId,
    limit,
  });
  const lastRow = rows.at(-1);
  const nextCursor =
    rows.length === limit && lastRow
      ? encodeBootstrapCursor(String(lastRow.id))
      : null;

  return {
    resource: 'activities' as const,
    items: rows.map(toActivityDTO),
    nextCursor,
    snapshotCursor,
    retention,
  };
}

async function buildPhotosPage({
  photosRepo,
  athleteId,
  afterKey,
  limit,
  snapshotCursor,
  retention,
}: {
  photosRepo: Pick<PhotosRepository, 'findPageByAthlete'>;
  athleteId: number;
  afterKey: string | undefined;
  limit: number;
  snapshotCursor: string | null;
  retention: RetentionMeta;
}) {
  const rows = await photosRepo.findPageByAthlete(athleteId, {
    afterId: afterKey,
    limit,
  });
  const lastRow = rows.at(-1);
  const nextCursor =
    rows.length === limit && lastRow
      ? encodeBootstrapCursor(lastRow.unique_id)
      : null;

  return {
    resource: 'photos' as const,
    items: rows.map(toPhotoDTO),
    nextCursor,
    snapshotCursor,
    retention,
  };
}
