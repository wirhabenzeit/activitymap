import {
  initialImportDTOSchema,
  type InitialImportDTO,
} from '~/contracts/v1/initial-import';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';

export function createInitialImportHandler(deps: {
  resolveActor: (request: Request) => Promise<Actor | null>;
  read: (actor: Actor) => Promise<InitialImportDTO>;
  advance: (actor: Actor) => Promise<InitialImportDTO>;
  onError?: (error: unknown, requestId: string) => void;
}) {
  return async (request: Request) => {
    const requestId = requestIdFor(request);
    const headers = {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Authorization',
    };
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        return Response.json(
          errorEnvelope('not_authenticated', 'Authentication is required.', {
            requestId,
          }),
          { status: 401, headers },
        );
      // Native bearer calls have no Origin. Browser mutations must be same-origin.
      const origin = request.headers.get('origin');
      if (
        request.method === 'POST' &&
        origin &&
        origin !== new URL(request.url).origin
      ) {
        return Response.json(
          errorEnvelope('forbidden', 'The request origin is not allowed.', {
            requestId,
          }),
          { status: 403, headers },
        );
      }
      const data = await (request.method === 'POST' ? deps.advance : deps.read)(
        actor,
      );
      return Response.json(
        responseEnvelope(initialImportDTOSchema).parse(
          makeEnvelope(data, new Date()),
        ),
        { headers },
      );
    } catch (error) {
      deps.onError?.(error, requestId);
      return Response.json(
        errorEnvelope(
          'initial_import_unavailable',
          'Could not check your initial import. Try again later.',
          { requestId, retryable: true },
        ),
        {
          status: 503,
          headers: { ...headers, 'Retry-After': '60' },
        },
      );
    }
  };
}
