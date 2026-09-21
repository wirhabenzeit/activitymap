import { randomUUID } from 'node:crypto';

import { requestIdFor } from '~/server/http/request-id';

import { makeEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import { revokeSessionRequestSchema } from '~/contracts/v1/mobile-auth';

export interface RevokeSessionHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /** `null` means unauthenticated (caller has no session of their own). */
  isAuthenticated: (headers: Headers) => Promise<boolean>;
  /**
   * Revokes the named session token. Wired in `route.ts` via
   * `auth.api.revokeSession`, which already only revokes a session
   * belonging to the caller (per-device revocation, issue #121).
   */
  revokeSessionByToken: (token: string, headers: Headers) => Promise<void>;
}

/**
 * Build the `POST /api/v1/auth/sessions/revoke` Route Handler: revokes one
 * of the caller's own sessions by token, for per-device sign-out (issue
 * #121's "ideally a list my sessions / revoke one by id" capability).
 */
export function createRevokeSessionHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  isAuthenticated,
  revokeSessionByToken,
}: RevokeSessionHandlerDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);

    if (!(await isAuthenticated(request.headers))) {
      return Response.json(
        errorEnvelope('not_authenticated', 'Authentication is required.', {
          requestId,
        }),
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        errorEnvelope('validation_failed', 'Request body must be JSON.', {
          requestId,
        }),
        { status: 400 },
      );
    }

    const parsedBody = revokeSessionRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return Response.json(
        errorEnvelope('validation_failed', 'Request body is invalid.', {
          requestId,
          details: parsedBody.error.flatten(),
        }),
        { status: 400 },
      );
    }

    try {
      await revokeSessionByToken(parsedBody.data.token, request.headers);
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
