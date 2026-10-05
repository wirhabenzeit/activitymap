import { randomUUID } from 'node:crypto';

import { requestIdFor } from '~/server/http/request-id';

import type { Actor } from '~/server/auth/actor';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  INGESTION_STATUS_MAX_AGE_SECONDS,
  ingestionStatusDTOSchema,
  type IngestionStatusDTO,
} from '~/contracts/v1/ingestion-status';

export interface IngestionStatusHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  resolveActor: (request: Request) => Promise<Actor | null>;
  /** Read-only and account-scoped: never calls Strava or loads samples/media. */
  loadStatus: (actor: Actor, observedAt: Date) => Promise<IngestionStatusDTO>;
}

/**
 * Build the `GET /api/v1/ingestion-status` Route Handler (issue #297). The
 * response is privately cacheable for a short period, which is also the
 * polling interval clients should respect.
 */
export function createIngestionStatusHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  resolveActor,
  loadStatus,
}: IngestionStatusHandlerDependencies) {
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

      const observedAt = now();
      const status = await loadStatus(actor, observedAt);
      const body = responseEnvelope(ingestionStatusDTOSchema).parse(
        makeEnvelope(status, observedAt),
      );
      return Response.json(body, {
        headers: {
          'cache-control': `private, max-age=${INGESTION_STATUS_MAX_AGE_SECONDS}`,
          vary: 'authorization, cookie',
        },
      });
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
