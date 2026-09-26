import { ZodError, z } from 'zod';

import {
  activityRefreshResultSchema,
  updateActivityRequestSchema,
  type UpdateActivityRequest,
} from '~/contracts/v1/activity-mutations';
import { activityDTOSchema, toActivityDTO } from '~/contracts/v1/activity';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import { toPhotoDTO } from '~/contracts/v1/photo';
import type { Actor } from '~/server/auth/actor';
import {
  ActivityMutationError,
  refreshActivityForActor,
  updateActivityForActor,
} from '~/server/application/activities';
import { requestIdFor } from '~/server/http/request-id';

const path = /^\/api\/v1\/activities\/([^/]+)(?:\/refresh)?\/?$/;
const activityIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((id) => Number.isSafeInteger(Number(id)), {
    message: 'Activity ID exceeds the server storage range',
  });

type UpdateResult = Awaited<ReturnType<typeof updateActivityForActor>>;
type RefreshResult = Awaited<ReturnType<typeof refreshActivityForActor>>;

type MutationHandlerDependencies = {
  resolveActor: (request: Request) => Promise<Actor | null>;
  update?: (
    actor: Actor,
    input: UpdateActivityRequest & { id: number },
  ) => Promise<UpdateResult>;
  refresh?: (actor: Actor, activityId: number) => Promise<RefreshResult>;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
};

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
};

function failure(
  requestId: string,
  status: number,
  code: string,
  message: string,
  options: {
    retryable?: boolean;
    retryAfterSeconds?: number;
    details?: unknown;
  } = {},
) {
  return Response.json(
    errorEnvelope(code, message, {
      requestId,
      retryable: options.retryable,
      details: options.details,
    }),
    {
      status,
      headers: {
        ...privateHeaders,
        ...(options.retryAfterSeconds
          ? { 'Retry-After': String(options.retryAfterSeconds) }
          : {}),
      },
    },
  );
}

function mutationFailure(error: ActivityMutationError, requestId: string) {
  return failure(requestId, error.status, error.code, error.message, {
    retryable: error.retryable,
    retryAfterSeconds: error.retryAfterSeconds,
    details: error.details,
  });
}

function parseActivityId(request: Request): number | null {
  const match = path.exec(new URL(request.url).pathname);
  const parsed = activityIdSchema.safeParse(match?.[1]);
  return parsed.success ? Number(parsed.data) : null;
}

export function createUpdateActivityHandler(deps: MutationHandlerDependencies) {
  return async function PATCH(request: Request): Promise<Response> {
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
      const id = parseActivityId(request);
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
  return async function POST(request: Request): Promise<Response> {
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
      const id = parseActivityId(request);
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
