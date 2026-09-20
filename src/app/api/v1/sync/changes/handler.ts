import { randomUUID } from 'node:crypto';

import type { Actor } from '~/server/auth/actor';
import { toActivityDTO } from '~/contracts/v1/activity';
import { toPhotoDTO } from '~/contracts/v1/photo';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  syncChangesPageDTOSchema,
  syncChangesQuerySchema,
  type SyncChangeItemDTO,
} from '~/contracts/v1/sync';
import { toIdString } from '~/contracts/v1/primitives';
import { encodeSyncCursor, tryDecodeSyncCursor } from '~/server/sync/cursor';
import type { ActivitiesRepository } from '~/server/repositories/activities';
import type { PhotosRepository } from '~/server/repositories/photos';
import type { ChangesRepository } from '~/server/repositories/changes';
import { DEFAULT_RETENTION_DAYS } from '~/server/repositories/changes';
import type { SyncChange } from '~/server/db/schema';
import type { SummaryReconciliationRepository } from '~/server/repositories/summary-reconciliation';

export interface SyncChangesHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /** Resolves the authenticated Actor for a request, or `null` if unauthenticated. Wired in `route.ts` via `~/server/auth/actor.ts`'s `resolveActor`. */
  resolveActor: (request: Request) => Promise<Actor | null>;
  activitiesRepo: Pick<ActivitiesRepository, 'findManyByIds'>;
  photosRepo: Pick<PhotosRepository, 'findManyByIds'>;
  changesRepo: Pick<ChangesRepository, 'findAfter' | 'latestSequence'>;
  freshnessRepo?: Pick<SummaryReconciliationRepository, 'lastCompletedAt'>;
  /** Overridable only for tests; production always uses `DEFAULT_RETENTION_DAYS`. */
  retentionDays?: number;
}

function requestIdFor(request: Request, createRequestId: () => string): string {
  const suppliedRequestId = request.headers.get('x-request-id')?.trim();
  if (suppliedRequestId) return suppliedRequestId;
  return createRequestId();
}

/**
 * Build the `GET /api/v1/sync/changes` Route Handler (issue #123): a
 * bounded, `sync_change.sequence`-ordered page of upserts and deletions
 * after the caller's cursor, for a native client to apply into local SQLite
 * in one transaction before advancing its own stored cursor.
 *
 * Never driven by `changed_at` (two changes can share a timestamp - see
 * `~/server/sync/cursor.ts`'s doc comment on exactly that bug in the legacy
 * offline sync this replaces) - always by `sequence`, via
 * `ChangesRepository.findAfter`.
 *
 * A cursor that is malformed, from an unsupported version, belongs to a
 * different athlete, is older than the retention window, or points beyond
 * this athlete's current high-water mark always gets
 * `409 sync_rebootstrap_required`, never a partial or best-effort result.
 */
export function createSyncChangesHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  resolveActor,
  activitiesRepo,
  photosRepo,
  changesRepo,
  freshnessRepo = { lastCompletedAt: async () => null },
  retentionDays = DEFAULT_RETENTION_DAYS,
}: SyncChangesHandlerDependencies) {
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
      const parsedQuery = syncChangesQuerySchema.safeParse({
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

      const { cursor, limit } = parsedQuery.data;
      const decoded = tryDecodeSyncCursor(cursor);
      if (decoded === null) {
        return rebootstrapRequired(requestId, 'The `cursor` parameter is invalid.');
      }

      if (decoded.athleteId !== actor.athleteId) {
        return rebootstrapRequired(
          requestId,
          'The requested cursor belongs to a different athlete.',
        );
      }

      const nowValue = now();
      const cursorValidUntil = new Date(
        Date.parse(decoded.issuedAt) + retentionDays * 24 * 60 * 60 * 1000,
      );
      if (nowValue.getTime() >= cursorValidUntil.getTime()) {
        return rebootstrapRequired(
          requestId,
          'The requested cursor is older than the retained change history.',
        );
      }

      const latestSequence = await changesRepo.latestSequence(actor.athleteId);
      if (decoded.sequence > latestSequence) {
        return rebootstrapRequired(
          requestId,
          'The requested cursor is beyond the current change-feed high-water mark.',
        );
      }

      const changes = await changesRepo.findAfter(
        actor.athleteId,
        decoded.sequence,
        { limit },
      );

      const items = await resolveChangeItems(changes, {
        activitiesRepo,
        photosRepo,
      });

      const lastSequence = changes.at(-1)?.sequence ?? decoded.sequence;
      const nextCursor =
        changes.length === 0
          ? cursor
          : encodeSyncCursor({
              sequence: lastSequence,
              athleteId: actor.athleteId,
              issuedAt: nowValue,
            });
      const nextCursorValidUntil =
        changes.length === 0
          ? cursorValidUntil
          : new Date(
              nowValue.getTime() + retentionDays * 24 * 60 * 60 * 1000,
            );
      const payload = {
        items,
        nextCursor,
        retention: {
          retentionDays,
          cursorValidUntil: nextCursorValidUntil.toISOString(),
        },
        freshness: {
          lastSummaryReconciledAt: (
            await freshnessRepo.lastCompletedAt(actor.athleteId)
          )?.toISOString() ?? null,
        },
      };

      const body = responseEnvelope(syncChangesPageDTOSchema).parse(
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

    function rebootstrapRequired(id: string, message: string): Response {
      return Response.json(
        errorEnvelope('sync_rebootstrap_required', message, {
          requestId: id,
          retryable: false,
        }),
        { status: 409 },
      );
    }
  };
}

/**
 * Resolve each change row's current entity data (for an upsert) into a
 * `SyncChangeItemDTO`, batching the entity lookups by type rather than one
 * query per row.
 *
 * An upsert whose current row can no longer be found (already deleted by a
 * later mutation than this change record) is dropped rather than emitted as
 * a stale or empty item: the later delete is guaranteed to appear as its
 * own change record - on this page if it happened before this query ran, or
 * on a subsequent page otherwise - so the client still learns to remove the
 * entity; it just does so slightly later, never incorrectly.
 */
async function resolveChangeItems(
  changes: SyncChange[],
  deps: {
    activitiesRepo: Pick<ActivitiesRepository, 'findManyByIds'>;
    photosRepo: Pick<PhotosRepository, 'findManyByIds'>;
  },
): Promise<SyncChangeItemDTO[]> {
  const activityIds = Array.from(
    new Set(
      changes
        .filter((c) => c.entityType === 'activity' && c.operation === 'upsert')
        .map((c) => Number(c.entityId)),
    ),
  );
  const photoIds = Array.from(
    new Set(
      changes
        .filter((c) => c.entityType === 'photo' && c.operation === 'upsert')
        .map((c) => c.entityId),
    ),
  );

  const [activityRows, photoRows] = await Promise.all([
    activityIds.length > 0
      ? deps.activitiesRepo.findManyByIds(activityIds)
      : Promise.resolve([]),
    photoIds.length > 0
      ? deps.photosRepo.findManyByIds(photoIds)
      : Promise.resolve([]),
  ]);

  const activityById = new Map(activityRows.map((row) => [row.id, row]));
  const photoById = new Map(photoRows.map((row) => [row.unique_id, row]));

  const items: SyncChangeItemDTO[] = [];
  for (const change of changes) {
    if (change.operation === 'delete') {
      items.push({
        sequence: toIdString(change.sequence),
        entityType: change.entityType,
        operation: 'delete',
        id: change.entityId,
      });
      continue;
    }

    if (change.entityType === 'activity') {
      const activity = activityById.get(Number(change.entityId));
      if (!activity) continue;
      items.push({
        sequence: toIdString(change.sequence),
        entityType: 'activity',
        operation: 'upsert',
        id: change.entityId,
        activity: toActivityDTO(activity),
      });
    } else {
      const photo = photoById.get(change.entityId);
      if (!photo) continue;
      items.push({
        sequence: toIdString(change.sequence),
        entityType: 'photo',
        operation: 'upsert',
        id: change.entityId,
        photo: toPhotoDTO(photo),
      });
    }
  }
  return items;
}
