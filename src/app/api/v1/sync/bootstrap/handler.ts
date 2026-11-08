import { randomUUID } from 'node:crypto';

import { type ActivityDTO, toActivityDTO } from '~/contracts/v1/activity';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import { type PhotoDTO, toPhotoDTO } from '~/contracts/v1/photo';
import {
  syncBootstrapPageDTOSchema,
  syncBootstrapQuerySchema,
} from '~/contracts/v1/sync';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';
import type { ActivitiesRepository } from '~/server/repositories/activities';
import type { ChangesRepository } from '~/server/repositories/changes';
import { DEFAULT_RETENTION_DAYS } from '~/server/repositories/changes';
import type { PhotosRepository } from '~/server/repositories/photos';
import type { PlaceMatchingRepository } from '~/server/repositories/place-matching';
import type { SummaryReconciliationRepository } from '~/server/repositories/summary-reconciliation';
import {
  decodeScopedBootstrapCursor,
  encodeScopedBootstrapCursor,
} from '~/server/sync/bootstrap-cursor';
import { encodeSyncCursor } from '~/server/sync/cursor';

export type BootstrapSnapshot = {
  sequence: number;
  lastSummaryReconciledAt: Date | null;
  matchingVersion: string;
  more: boolean;
  page:
    | { resource: 'activities'; items: ActivityDTO[] }
    | { resource: 'photos'; items: PhotoDTO[] };
};

export interface SyncBootstrapHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /** Resolves the authenticated Actor for a request, or `null` if unauthenticated. Wired in `route.ts` via `~/server/auth/actor.ts`'s `resolveActor`. */
  resolveActor: (request: Request) => Promise<Actor | null>;
  activitiesRepo: Pick<ActivitiesRepository, 'findPageByAthlete'>;
  photosRepo: Pick<PhotosRepository, 'findPageByAthlete'>;
  cursorBackend?: string;
  /** Optional backend-native snapshot read; keeps its high-water and page atomic. */
  bootstrapPage?: (
    actor: Actor,
    args: {
      resource: 'activities' | 'photos';
      afterKey?: string;
      limit: number;
    },
  ) => Promise<BootstrapSnapshot>;
  defaultPageSize?: number;
  changesRepo: Pick<ChangesRepository, 'latestSequence'>;
  placesRepo?: Pick<PlaceMatchingRepository, 'sync'>;
  freshnessRepo?: Pick<SummaryReconciliationRepository, 'lastCompletedAt'>;
  /** Overridable only for tests; production always uses `DEFAULT_RETENTION_DAYS`. */
  retentionDays?: number;
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
  cursorBackend,
  bootstrapPage,
  defaultPageSize,
  freshnessRepo = { lastCompletedAt: async () => null },
  placesRepo,
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
        limit: url.searchParams.get('limit') ?? defaultPageSize,
      });
      if (!parsedQuery.success) {
        return Response.json(
          errorEnvelope(
            'validation_failed',
            'The query parameters are invalid.',
            {
              requestId,
              details: parsedQuery.error.flatten(),
            },
          ),
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

      const cursorScope = cursorBackend && `${cursorBackend}.${resource}`;
      let afterKey: string | undefined;
      if (cursor !== undefined) {
        const { key, foreign } = decodeScopedBootstrapCursor(
          cursor,
          cursorScope,
        );
        if (foreign) {
          return Response.json(
            errorEnvelope(
              'sync_rebootstrap_required',
              'The requested cursor belongs to a different bootstrap scope.',
              { requestId },
            ),
            { status: 409 },
          );
        }
        if (key === null) {
          return Response.json(
            errorEnvelope(
              'validation_failed',
              'The `cursor` parameter is invalid.',
              {
                requestId,
              },
            ),
            { status: 400 },
          );
        }
        afterKey = key;
      }

      if (
        resource === 'activities' &&
        afterKey !== undefined &&
        !Number.isInteger(Number(afterKey))
      ) {
        return Response.json(
          errorEnvelope(
            'validation_failed',
            'The `cursor` parameter is invalid.',
            {
              requestId,
            },
          ),
          { status: 400 },
        );
      }

      const nowValue = now();
      const snapshot = bootstrapPage
        ? await bootstrapPage(actor, { resource, afterKey, limit })
        : null;
      if (snapshot && snapshot.page.resource !== resource)
        throw new Error('Bootstrap resource mismatch');
      const snapshotCursor = isFirstPage
        ? encodeSyncCursor({
            sequence: snapshot
              ? snapshot.sequence
              : await changesRepo.latestSequence(actor.athleteId),
            athleteId: actor.athleteId,
            issuedAt: nowValue,
            backend: cursorBackend,
          })
        : null;
      const retention = {
        retentionDays,
        cursorValidUntil: new Date(
          nowValue.getTime() + retentionDays * 24 * 60 * 60 * 1000,
        ).toISOString(),
      };
      const freshness = {
        lastSummaryReconciledAt:
          (snapshot
            ? snapshot.lastSummaryReconciledAt
            : await freshnessRepo.lastCompletedAt(actor.athleteId)
          )?.toISOString() ?? null,
      };

      const last = snapshot?.page.items.at(-1);
      const lastKey = last && ('id' in last ? last.id : last.unique_id);
      if (snapshot?.more && !lastKey)
        throw new Error('Empty advancing bootstrap page');
      const payload = snapshot
        ? {
            ...snapshot.page,
            nextCursor:
              snapshot.more && lastKey
                ? encodeScopedBootstrapCursor(lastKey, cursorScope)
                : null,
            snapshotCursor,
            retention,
            freshness: {
              ...freshness,
              placeMatchingVersion: snapshot.matchingVersion,
            },
          }
        : resource === 'activities'
          ? await buildActivitiesPage({
              activitiesRepo,
              athleteId: actor.athleteId,
              afterKey,
              limit,
              snapshotCursor,
              cursorScope,
              retention,
              freshness,
            })
          : await buildPhotosPage({
              photosRepo,
              athleteId: actor.athleteId,
              afterKey,
              limit,
              snapshotCursor,
              cursorScope,
              retention,
              freshness,
            });

      if (placesRepo && !snapshot) {
        const matches = await placesRepo.sync(
          actor,
          payload.resource === 'activities'
            ? payload.items.map((item) => item.id)
            : [],
        );
        Object.assign(payload.freshness, {
          placeMatchingVersion: matches.version,
        });
        if (payload.resource === 'activities') {
          for (const item of payload.items)
            item.placeMatches = matches.results.get(item.id);
        }
      }

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
type FreshnessMeta = { lastSummaryReconciledAt: string | null };

async function buildActivitiesPage({
  activitiesRepo,
  athleteId,
  afterKey,
  limit,
  snapshotCursor,
  cursorScope,
  retention,
  freshness,
}: {
  activitiesRepo: Pick<ActivitiesRepository, 'findPageByAthlete'>;
  athleteId: number;
  afterKey: string | undefined;
  limit: number;
  snapshotCursor: string | null;
  cursorScope?: string;
  retention: RetentionMeta;
  freshness: FreshnessMeta;
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
      ? encodeScopedBootstrapCursor(String(lastRow.id), cursorScope)
      : null;

  return {
    resource: 'activities' as const,
    items: rows.map(toActivityDTO),
    nextCursor,
    snapshotCursor,
    retention,
    freshness,
  };
}

async function buildPhotosPage({
  photosRepo,
  athleteId,
  afterKey,
  limit,
  snapshotCursor,
  cursorScope,
  retention,
  freshness,
}: {
  photosRepo: Pick<PhotosRepository, 'findPageByAthlete'>;
  athleteId: number;
  afterKey: string | undefined;
  limit: number;
  snapshotCursor: string | null;
  cursorScope?: string;
  retention: RetentionMeta;
  freshness: FreshnessMeta;
}) {
  const rows = await photosRepo.findPageByAthlete(athleteId, {
    afterId: afterKey,
    limit,
  });
  const lastRow = rows.at(-1);
  const nextCursor =
    rows.length === limit && lastRow
      ? encodeScopedBootstrapCursor(lastRow.unique_id, cursorScope)
      : null;

  return {
    resource: 'photos' as const,
    items: rows.map(toPhotoDTO),
    nextCursor,
    snapshotCursor,
    retention,
    freshness,
  };
}
