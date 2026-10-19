import { randomUUID } from 'node:crypto';

import { deleteAccountRequestSchema } from '~/contracts/v1/account-deletion';
import { makeEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import { mutationOriginAllowed } from '~/server/api/transport';
import { requestIdFor } from '~/server/http/request-id';

type DeletionSession = { userId: string; token: string };
export interface AccountDeletionDependencies {
  resolveSession: (headers: Headers) => Promise<DeletionSession | null>;
  deleteForSession: (
    userId: string,
    token: string,
    now: Date,
  ) => Promise<boolean>;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
}

export function createAccountDeletionHandler({
  resolveSession,
  deleteForSession,
  now = () => new Date(),
  onError = () => undefined,
}: AccountDeletionDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, randomUUID);
    const failure = (
      code: string,
      message: string,
      status: number,
      retryable = false,
    ) =>
      Response.json(errorEnvelope(code, message, { requestId, retryable }), {
        status,
      });
    try {
      // Cookie-authenticated mutations require a same-origin browser request.
      // Native clients use a signed bearer credential and do not send Origin.
      if (!mutationOriginAllowed(request, 'required-unless-bearer')) {
        return failure('forbidden', 'A same-origin request is required.', 403);
      }
      const session = await resolveSession(request.headers);
      if (!session)
        return failure('not_authenticated', 'Authentication is required.', 401);
      if (
        request.headers.get('content-type')?.split(';')[0]?.trim() !==
        'application/json'
      ) {
        return failure(
          'validation_failed',
          'Confirm account deletion with a JSON request.',
          400,
        );
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return failure(
          'validation_failed',
          'A valid deletion confirmation is required.',
          400,
        );
      }
      if (!deleteAccountRequestSchema.safeParse(body).success) {
        return failure(
          'validation_failed',
          'A valid deletion confirmation is required.',
          400,
        );
      }
      const observedAt = now();
      if (
        !(await deleteForSession(session.userId, session.token, observedAt))
      ) {
        return failure('not_authenticated', 'Authentication is required.', 401);
      }
      return Response.json(
        makeEnvelope({ status: 'deleted' as const }, observedAt),
        {
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    } catch (error) {
      onError(error, requestId);
      return failure(
        'internal_error',
        'Account deletion could not be completed. Please try again.',
        500,
        true,
      );
    }
  };
}
