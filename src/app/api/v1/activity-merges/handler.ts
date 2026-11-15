import { ZodError } from 'zod';

import {
  mergeActivitiesRequestSchema,
  mergeFileRequestSchema,
  mergeUploadStateSchema,
  mergedActivityMetadataSchema,
} from '~/contracts/v1/activity-merge';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import {
  apiFailure as failure,
  mutationOriginAllowed,
  PRIVATE_API_HEADERS as privateHeaders,
} from '~/server/api/transport';
import { ActivityMutationError } from '~/server/application/activities';
import {
  buildMergedFile,
  continueMergeUpload,
  mergeActivities,
} from '~/server/application/activity-merge';
import type { Actor } from '~/server/auth/actor';
import { isActivityMergeEnabled } from '~/server/config/activity-merge';
import { requestIdFor } from '~/server/http/request-id';
import { errorDiagnostic } from '~/server/logging/error-diagnostic';

export type ActivityMergeHandlerDeps = {
  resolveActor: (request: Request) => Promise<Actor | null>;
  isEnabled?: (athleteId: number) => boolean;
  buildFile?: typeof buildMergedFile;
  merge?: typeof mergeActivities;
  continueUpload?: typeof continueMergeUpload;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
};

type Handle = (
  request: Request,
  actor: Actor,
  requestId: string,
) => Promise<Response>;

/** Authentication, rollout gate, origin and error mapping shared by the
 * merge endpoints. */
function guarded(deps: ActivityMergeHandlerDeps, handle: Handle) {
  return async (request: Request): Promise<Response> => {
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
      if (!(deps.isEnabled ?? isActivityMergeEnabled)(actor.athleteId))
        return failure(requestId, 404, 'not_found', 'Not found.');
      if (!mutationOriginAllowed(request, 'required-unless-bearer'))
        return failure(
          requestId,
          403,
          'forbidden',
          'The request origin is not allowed.',
        );
      return await handle(request, actor, requestId);
    } catch (error) {
      if (error instanceof ActivityMutationError) {
        if (error.status >= 500)
          deps.onError?.(
            { code: error.code, ...errorDiagnostic(error) },
            requestId,
          );
        return failure(requestId, error.status, error.code, error.message, {
          retryable: error.retryable,
          retryAfterSeconds: error.retryAfterSeconds,
          details: error.details,
        });
      }
      if (error instanceof ZodError || error instanceof SyntaxError)
        return failure(
          requestId,
          400,
          'validation_failed',
          'The request body is invalid.',
          { details: error instanceof ZodError ? error.flatten() : undefined },
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

function stateResponse(
  deps: ActivityMergeHandlerDeps,
  state: unknown,
): Response {
  return Response.json(
    responseEnvelope(mergeUploadStateSchema).parse(
      makeEnvelope(state, (deps.now ?? (() => new Date()))()),
    ),
    { headers: privateHeaders },
  );
}

/** `POST /api/v1/activity-merges/file`: the merged FIT file. */
export function createMergeFileHandler(deps: ActivityMergeHandlerDeps) {
  return guarded(deps, async (request, actor) => {
    const body = mergeFileRequestSchema.parse(await request.json());
    const file = await (deps.buildFile ?? buildMergedFile)(actor, body);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'application/vnd.ant.fit',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Content-Length': String(file.bytes.byteLength),
      },
    });
  });
}

/** `POST /api/v1/activity-merges`: upload the merged activity. */
export function createMergeActivitiesHandler(deps: ActivityMergeHandlerDeps) {
  return guarded(deps, async (request, actor) => {
    const body = mergeActivitiesRequestSchema.parse(await request.json());
    return stateResponse(
      deps,
      await (deps.merge ?? mergeActivities)(actor, body),
    );
  });
}

/** `POST /api/v1/activity-merges/uploads/{id}`: continue a processing upload. */
export function createContinueMergeUploadHandler(
  deps: ActivityMergeHandlerDeps,
) {
  return async (request: Request, uploadId: string) =>
    guarded(deps, async (request, actor, requestId) => {
      if (!/^\d{1,19}$/.test(uploadId))
        return failure(
          requestId,
          400,
          'validation_failed',
          'The upload ID is invalid.',
        );
      const body = mergedActivityMetadataSchema.parse(await request.json());
      return stateResponse(
        deps,
        await (deps.continueUpload ?? continueMergeUpload)(
          actor,
          uploadId,
          body,
        ),
      );
    })(request);
}
