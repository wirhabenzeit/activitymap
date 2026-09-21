import { randomUUID } from 'node:crypto';

import { requestIdFor } from '~/server/http/request-id';

import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  mobileSessionListDTOSchema,
  type MobileSessionDTO,
} from '~/contracts/v1/mobile-auth';

export type SessionListEntry = {
  token: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export interface ListSessionsHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /**
   * Resolves the current session's own token (to mark `isCurrent`) and the
   * caller's full session list. `null` for either means unauthenticated.
   * Wired in `route.ts` via `auth.api.getSession`/`auth.api.listSessions`.
   */
  resolveSessions: (
    headers: Headers,
  ) => Promise<{ currentToken: string; sessions: SessionListEntry[] } | null>;
}

function toSessionDTO(
  entry: SessionListEntry,
  currentToken: string,
): MobileSessionDTO {
  return {
    token: entry.token,
    createdAt: entry.createdAt.toISOString(),
    expiresAt: entry.expiresAt.toISOString(),
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    isCurrent: entry.token === currentToken,
  };
}

/**
 * Build the `GET /api/v1/auth/sessions` Route Handler: lists the caller's
 * own active sessions (one per signed-in device/browser), for the
 * per-device revocation UI described in issue #121.
 */
export function createListSessionsHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  resolveSessions,
}: ListSessionsHandlerDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);

    try {
      const resolved = await resolveSessions(request.headers);
      if (!resolved) {
        return Response.json(
          errorEnvelope('not_authenticated', 'Authentication is required.', {
            requestId,
          }),
          { status: 401 },
        );
      }

      const dto = {
        sessions: resolved.sessions.map((entry) =>
          toSessionDTO(entry, resolved.currentToken),
        ),
      };

      const responseBody = responseEnvelope(mobileSessionListDTOSchema).parse(
        makeEnvelope(dto, now()),
      );
      return Response.json(responseBody);
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
