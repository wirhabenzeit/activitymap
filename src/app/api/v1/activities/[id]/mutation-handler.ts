import { ZodError } from 'zod';

import { activityDTOSchema, toActivityDTO } from '~/contracts/v1/activity';
import {
  type UpdateActivityRequest,
  activityRefreshResultSchema,
  activitySummaryFetchResultSchema,
  updateActivityRequestSchema,
} from '~/contracts/v1/activity-mutations';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { toPhotoDTO } from '~/contracts/v1/photo';
import {
  apiFailure as failure,
  mutationOriginAllowed,
  PRIVATE_API_HEADERS as privateHeaders,
} from '~/server/api/transport';
import {
  ActivityMutationError,
  fetchInitialActivitySummariesForActor,
  refreshActivityForActor,
  updateActivityForActor,
} from '~/server/application/activities';
import {
  SIGNUP_WARMUP_TIME_MS,
  warmSignupActivitiesForActor,
} from '~/server/application/signup-warmup';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';

type UpdateResult = Awaited<ReturnType<typeof updateActivityForActor>>;
type RefreshResult = Awaited<ReturnType<typeof refreshActivityForActor>>;

type MutationHandlerDependencies = {
  resolveActor: (request: Request) => Promise<Actor | null>;
  update?: (
    actor: Actor,
    input: UpdateActivityRequest & { id: number },
  ) => Promise<UpdateResult>;
  refresh?: (actor: Actor, activityId: number) => Promise<RefreshResult>;
  fetchSummaries?: (actor: Actor) => Promise<number>;
  afterResponse?: (work: () => Promise<void>) => void;
  warmSignup?: typeof warmSignupActivitiesForActor;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
};

function mutationFailure(error: ActivityMutationError, requestId: string) {
  return failure(requestId, error.status, error.code, error.message, {
    retryable: error.retryable,
    retryAfterSeconds: error.retryAfterSeconds,
    details: error.details,
  });
}

/** Blocking first-page summary fetch, using the same mutation/error boundary. */
export function createFetchActivitySummariesHandler(
  deps: MutationHandlerDependencies,
) {
  return async (request: Request) => {
    const requestId = requestIdFor(request);
    const startedAt = Date.now();
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
      const count = await (
        deps.fetchSummaries ?? fetchInitialActivitySummariesForActor
      )(actor);
      if (count > 0 && deps.afterResponse) {
        // Leave ten seconds of the route's 60s lifetime for persistence and
        // cleanup, including time already spent importing the first page.
        try {
          deps.afterResponse(async () => {
            const timeMs = Math.min(
              SIGNUP_WARMUP_TIME_MS,
              50_000 - (Date.now() - startedAt),
            );
            if (timeMs <= 0) return;
            try {
              await (deps.warmSignup ?? warmSignupActivitiesForActor)(
                actor,
                count,
                { timeMs },
              );
            } catch (error) {
              deps.onError?.(error, requestId);
            }
          });
        } catch (error) {
          // Optional acceleration must never turn a saved import into a 500.
          deps.onError?.(error, requestId);
        }
      }
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
      const activity = await (deps.update ?? updateActivityForActor)(actor, {
        id,
        ...body,
      });
      return Response.json(
        responseEnvelope(activityDTOSchema).parse(
          makeEnvelope(
            toActivityDTO(activity),
            (deps.now ?? (() => new Date()))(),
          ),
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
      const result = await (deps.refresh ?? refreshActivityForActor)(actor, id);
      const data = activityRefreshResultSchema.parse({
        activity: toActivityDTO(result.activity),
        photos: result.photos.map(toPhotoDTO),
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
