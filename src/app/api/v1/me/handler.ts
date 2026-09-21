import { randomUUID } from 'node:crypto';

import { requestIdFor } from '~/server/http/request-id';

import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  currentUserDTOSchema,
  type CurrentUserDTOv1,
} from '~/contracts/v1/user';

export interface CurrentUserHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  resolveCurrentUser: (request: Request) => Promise<CurrentUserDTOv1 | null>;
}

/**
 * Build the GET /api/v1/me Route Handler around an injectable identity
 * resolver. Keeping the HTTP boundary pure makes its exact serialized success,
 * authentication-failure, and contract-failure responses testable without a
 * live database or a request-global session.
 */
export function createCurrentUserHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  resolveCurrentUser,
}: CurrentUserHandlerDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);

    try {
      const currentUser = await resolveCurrentUser(request);
      if (!currentUser) {
        return Response.json(
          errorEnvelope('not_authenticated', 'Authentication is required.', {
            requestId,
          }),
          { status: 401 },
        );
      }

      const body = responseEnvelope(currentUserDTOSchema).parse(
        makeEnvelope(currentUser, now()),
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
