import { randomUUID } from 'node:crypto';

import { requestIdFor } from '~/server/http/request-id';

import { makeEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';

export interface LogoutHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /**
   * Resolves the raw session token backing the current request (cookie or
   * bearer), or `null` if unauthenticated. Wired in `route.ts` via
   * `auth.api.getSession`.
   */
  resolveCurrentSessionToken: (headers: Headers) => Promise<string | null>;
  /**
   * Revokes the given session so it never resolves to an `Actor` again -
   * `~/server/auth/actor.ts`'s `resolveActor` calls `auth.api.getSession`,
   * which returns nothing for a revoked session token. Wired in `route.ts`
   * via `auth.api.revokeSession`.
   */
  revokeSessionByToken: (token: string, headers: Headers) => Promise<void>;
}

/**
 * Build the `POST /api/v1/auth/logout` Route Handler: revokes the caller's
 * own current session (browser cookie or mobile bearer token alike). See
 * issue #121's "logout and per-device session revocation".
 */
export function createLogoutHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  resolveCurrentSessionToken,
  revokeSessionByToken,
}: LogoutHandlerDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);

    try {
      const token = await resolveCurrentSessionToken(request.headers);
      if (!token) {
        return Response.json(
          errorEnvelope('not_authenticated', 'Authentication is required.', {
            requestId,
          }),
          { status: 401 },
        );
      }

      await revokeSessionByToken(token, request.headers);

      return Response.json(makeEnvelope({ status: 'revoked' }, now()));
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
