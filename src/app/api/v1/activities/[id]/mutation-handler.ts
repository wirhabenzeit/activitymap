import { ZodError } from 'zod';

import { activityDTOSchema } from '~/contracts/v1/activity';
import {
  activityRefreshResultSchema,
  activitySummaryFetchResultSchema,
  updateActivityRequestSchema,
} from '~/contracts/v1/activity-mutations';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import {
  apiFailure as failure,
  mutationOriginAllowed,
  PRIVATE_API_HEADERS as privateHeaders,
} from '~/server/api/transport';
import { ActivityMutationError } from '~/server/application/activities';
import {
  refreshActivityThroughConvex,
  updateActivityThroughConvex,
} from '~/server/application/convex-activity-commands';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';

type MutationHandlerDependencies = {
  resolveActor: (request: Request) => Promise<Actor | null>;
  updateThroughConvex?: typeof updateActivityThroughConvex;
  refreshThroughConvex?: typeof refreshActivityThroughConvex;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
};

/** Who writes the actor's library. During a handoff nobody does, and a
 * command would change Strava without anywhere to record the result. */
function mutationFailure(error: ActivityMutationError, requestId: string) {
  return failure(requestId, error.status, error.code, error.message, {
    retryable: error.retryable,
    retryAfterSeconds: error.retryAfterSeconds,
    details: error.details,
  });
}

/** Blocking first-page summary fetch, using the same mutation/error boundary. */
export function createFetchActivitySummariesHandler(
  deps: Pick<MutationHandlerDependencies, 'resolveActor' | 'onError'> & {
    /** Starts the first fetch; answers how many activities are known. */
    fetchSummaries: (actor: Actor) => Promise<number>;
  },
) {
  return async (request: Request) => {
    const requestId = requestIdFor(request);
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        return failure(
          requestId,
          401,
          'not_authenticated',
          'Authentication is required.',
        );
      if (!mutationOriginAllowed(request, 'if-present'))
        return failure(
          requestId,
          403,
          'forbidden',
          'The request origin is not allowed.',
        );
      const count = await deps.fetchSummaries(actor);
      return Response.json(
        responseEnvelope(activitySummaryFetchResultSchema).parse(
          makeEnvelope(count),
        ),
        { headers: privateHeaders },
      );
    } catch (error) {
      if (error instanceof ActivityMutationError)
        return mutationFailure(error, requestId);
      deps.onError?.(error, requestId);
      return failure(
        requestId,
        500,
        'internal_error',
        'The activities could not be fetched.',
        { retryable: true },
      );
    }
  };
}

export function createUpdateActivityHandler(deps: MutationHandlerDependencies) {
  return async function PATCH(
    request: Request,
    id: number | null,
  ): Promise<Response> {
    const requestId = requestIdFor(request);
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        return failure(
          requestId,
          401,
          'not_authenticated',
          'Authentication is required.',
        );
      if (id === null)
        return failure(
          requestId,
          400,
          'validation_failed',
          'The activity ID is invalid.',
        );
      const body = updateActivityRequestSchema.parse(await request.json());
      const input = { id, ...body };
      const activity = await (
        deps.updateThroughConvex ?? updateActivityThroughConvex
      )(actor, input);
      return Response.json(
        responseEnvelope(activityDTOSchema).parse(
          makeEnvelope(activity, (deps.now ?? (() => new Date()))()),
        ),
        { headers: privateHeaders },
      );
    } catch (error) {
      if (error instanceof ActivityMutationError)
        return mutationFailure(error, requestId);
      if (error instanceof ZodError || error instanceof SyntaxError)
        return failure(
          requestId,
          400,
          'validation_failed',
          'The request body is invalid.',
          {
            details: error instanceof ZodError ? error.flatten() : undefined,
          },
        );
      deps.onError?.(error, requestId);
      return failure(
        requestId,
        500,
        'internal_error',
        'The request could not be completed.',
        { retryable: true },
      );
    }
  };
}

export function createRefreshActivityHandler(
  deps: MutationHandlerDependencies,
) {
  return async function POST(
    request: Request,
    id: number | null,
  ): Promise<Response> {
    const requestId = requestIdFor(request);
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        return failure(
          requestId,
          401,
          'not_authenticated',
          'Authentication is required.',
        );
      if (id === null)
        return failure(
          requestId,
          400,
          'validation_failed',
          'The activity ID is invalid.',
        );
      const result = await (
        deps.refreshThroughConvex ?? refreshActivityThroughConvex
      )(actor, id);
      const data = activityRefreshResultSchema.parse({
        activity: result.activity,
        photos: result.photos,
        photos_status: result.photosStatus,
        photos_error: result.photosError
          ? {
              code: result.photosError.code,
              retryable: result.photosError.retryable,
              retry_after_seconds: result.photosError.retryAfterSeconds ?? null,
            }
          : null,
      });
      return Response.json(
        responseEnvelope(activityRefreshResultSchema).parse(
          makeEnvelope(data, (deps.now ?? (() => new Date()))()),
        ),
        {
          headers: {
            ...privateHeaders,
            ...(result.photosError?.retryAfterSeconds
              ? {
                  'Retry-After': String(result.photosError.retryAfterSeconds),
                }
              : {}),
          },
        },
      );
    } catch (error) {
      if (error instanceof ActivityMutationError)
        return mutationFailure(error, requestId);
      deps.onError?.(error, requestId);
      return failure(
        requestId,
        500,
        'internal_error',
        'The request could not be completed.',
        { retryable: true },
      );
    }
  };
}
