import { randomUUID } from 'node:crypto';

import { requestIdFor } from '~/server/http/request-id';

import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  mobileExchangeRequestSchema,
  mobileExchangeResponseDTOSchema,
  toMobileExchangeResponseDTO,
} from '~/contracts/v1/mobile-auth';
import { MobileAuthError, type MobileAuthErrorCode } from '~/server/auth/mobile';

export interface MobileExchangeHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /** Wired in `route.ts` to `exchangeMobileLoginCode`. */
  exchangeCode: (input: {
    code: string;
    pkceVerifier: string;
    state: string;
  }) => Promise<{ bearerToken: string; userId: string }>;
  /**
   * Resolves the bearer session's expiry, doubling as a check that it is
   * still valid at exchange time (e.g. hasn't been revoked in the window
   * between the callback redirect and this call). Wired in `route.ts` to
   * `auth.api.getSession` with the bearer token as the `Authorization`
   * header - the same path a mobile client's later requests take.
   */
  resolveBearerSessionExpiry: (bearerToken: string) => Promise<Date | null>;
}

/** All `MobileAuthError` codes are authentication failures: 401. */
const MOBILE_AUTH_ERROR_STATUS: Record<MobileAuthErrorCode, number> = {
  invalid_code: 401,
  expired_code: 401,
  replayed_code: 401,
  state_mismatch: 401,
  pkce_mismatch: 401,
};

/**
 * Build the `POST /api/v1/auth/mobile/exchange` Route Handler: SwiftUI
 * exchanges the one-time code (plus its PKCE verifier and the original
 * `state`) it received on the universal-link redirect for the Better Auth
 * bearer session token it will store in the Keychain.
 */
export function createMobileExchangeHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  exchangeCode,
  resolveBearerSessionExpiry,
}: MobileExchangeHandlerDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);

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

    const parsedBody = mobileExchangeRequestSchema.safeParse(body);
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
      const { bearerToken } = await exchangeCode(parsedBody.data);

      const sessionExpiresAt = await resolveBearerSessionExpiry(bearerToken);
      if (!sessionExpiresAt) {
        // The code validated, but the underlying session is gone (e.g.
        // revoked in the window between the callback redirect and this
        // exchange) - do not hand back a token that will not resolve.
        return Response.json(
          errorEnvelope('not_authenticated', 'The session is no longer valid.', {
            requestId,
          }),
          { status: 401 },
        );
      }

      const dto = toMobileExchangeResponseDTO({
        sessionToken: bearerToken,
        sessionExpiresAt,
      });

      const responseBody = responseEnvelope(mobileExchangeResponseDTOSchema).parse(
        makeEnvelope(dto, now()),
      );
      return Response.json(responseBody);
    } catch (error) {
      if (error instanceof MobileAuthError) {
        return Response.json(
          errorEnvelope(error.code, error.message, { requestId }),
          { status: MOBILE_AUTH_ERROR_STATUS[error.code] },
        );
      }
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
