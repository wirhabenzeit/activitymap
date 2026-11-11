import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  type StravaImportDTO,
  stravaImportDTOSchema,
} from '~/contracts/v1/strava-import';
import {
  PRIVATE_API_HEADERS,
  mutationOriginAllowed,
} from '~/server/api/transport';
import { StravaImportError } from '~/server/application/strava-import';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';

type Dependencies = {
  resolveActor: (request: Request) => Promise<Actor | null>;
  read: (actor: Actor) => Promise<StravaImportDTO>;
  /** Starts the fetch in the backend; answers with its status. */
  start: (actor: Actor) => Promise<{ status: StravaImportDTO }>;
  onError: (error: unknown, requestId: string) => void;
};
const headers = {
  ...PRIVATE_API_HEADERS,
};
export function createStravaImportHandler(
  deps: Dependencies,
  method: 'GET' | 'POST',
) {
  return async (request: Request) => {
    const requestId = requestIdFor(request);
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        throw new StravaImportError(
          401,
          'not_authenticated',
          'Sign in to fetch from Strava.',
        );
      if (method === 'POST' && !mutationOriginAllowed(request, 'if-present'))
        throw new StravaImportError(
          403,
          'forbidden',
          'The request origin is not allowed.',
        );
      let status: StravaImportDTO;
      if (method === 'GET') status = await deps.read(actor);
      else status = (await deps.start(actor)).status;
      return Response.json(
        responseEnvelope(stravaImportDTOSchema).parse(makeEnvelope(status)),
        { status: 200, headers },
      );
    } catch (error) {
      if (!(error instanceof StravaImportError)) deps.onError(error, requestId);
      return Response.json(
        errorEnvelope(
          error instanceof StravaImportError ? error.code : 'internal_error',
          error instanceof StravaImportError
            ? error.message
            : 'Could not fetch from Strava. Please try again later.',
          { requestId, retryable: true },
        ),
        {
          status: error instanceof StravaImportError ? error.status : 500,
          headers,
        },
      );
    }
  };
}
