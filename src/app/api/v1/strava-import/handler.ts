import type { Actor } from '~/server/auth/actor';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  stravaImportDTOSchema,
  type StravaImportDTO,
} from '~/contracts/v1/strava-import';
import { StravaImportError } from '~/server/application/strava-import';
import type { ImportClaim } from '~/server/repositories/strava-import';
import { requestIdFor } from '~/server/http/request-id';

type Dependencies = {
  resolveActor: (request: Request) => Promise<Actor | null>;
  read: (actor: Actor) => Promise<StravaImportDTO>;
  start: (
    actor: Actor,
  ) => Promise<{ claim: ImportClaim | null; status: StravaImportDTO }>;
  run: (claim: ImportClaim, timeMs: number) => Promise<void>;
  afterResponse: (work: () => Promise<void>) => void;
  onError: (error: unknown, requestId: string) => void;
};
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
};
export function createStravaImportHandler(
  deps: Dependencies,
  method: 'GET' | 'POST',
) {
  return async (request: Request) => {
    const requestId = requestIdFor(request);
    const startedAt = Date.now();
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        throw new StravaImportError(
          401,
          'not_authenticated',
          'Sign in to fetch from Strava.',
        );
      const origin = request.headers.get('origin');
      if (method === 'POST' && origin && origin !== new URL(request.url).origin)
        throw new StravaImportError(
          403,
          'forbidden',
          'The request origin is not allowed.',
        );
      let status: StravaImportDTO;
      let accepted = false;
      if (method === 'GET') status = await deps.read(actor);
      else {
        const started = await deps.start(actor);
        status = started.status;
        if (started.claim) {
          const claim = started.claim;
          deps.afterResponse(async () => {
            try {
              await deps.run(
                claim,
                Math.max(
                  0,
                  Math.min(35_000, 50_000 - (Date.now() - startedAt)),
                ),
              );
            } catch (error) {
              deps.onError(error, requestId);
            }
          });
          accepted = true;
        }
      }
      return Response.json(
        responseEnvelope(stravaImportDTOSchema).parse(makeEnvelope(status)),
        { status: accepted ? 202 : 200, headers },
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
