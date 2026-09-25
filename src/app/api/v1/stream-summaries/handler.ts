import type { Actor } from '~/server/auth/actor';
import { errorEnvelope } from '~/contracts/v1/error';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import {
  activityStreamSummariesDTOSchema,
  toActivityStreamSummaryDTO,
} from '~/contracts/v1/activity-streams';
import { streamActivityIdSchema } from '~/server/strava/streams';
import {
  ActivityStreamsUnavailableError,
  type ActivityStreamsRepository,
} from '~/server/repositories/activity-streams';
import { requestIdFor } from '~/server/http/request-id';

export const STREAM_SUMMARIES_MAX_IDS = 100;

/**
 * Stored stream summaries for several owned activities, e.g. to prefetch the
 * routes a user selected. Never contacts Strava: activities without a
 * current set come back with `summary: null`; other athletes' IDs are omitted.
 */
export function createStreamSummariesHandler(deps: {
  resolveActor: (request: Request) => Promise<Actor | null>;
  repository: Pick<ActivityStreamsRepository, 'readSummaries'>;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
}) {
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFor(request);
    const headers = {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Authorization',
    };
    const fail = (status: number, code: string, message: string) =>
      Response.json(errorEnvelope(code, message, { requestId }), {
        status,
        headers,
      });
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        return fail(401, 'not_authenticated', 'Authentication is required.');
      const ids = [
        ...new Set(
          (new URL(request.url).searchParams.get('ids') ?? '')
            .split(',')
            .filter(Boolean),
        ),
      ];
      if (
        ids.length === 0 ||
        ids.length > STREAM_SUMMARIES_MAX_IDS ||
        !ids.every((id) => streamActivityIdSchema.safeParse(id).success)
      )
        return fail(
          400,
          'validation_failed',
          `Pass 1 to ${STREAM_SUMMARIES_MAX_IDS} comma-separated activity IDs.`,
        );
      const reads = await deps.repository.readSummaries(actor, ids);
      const now = deps.now ?? (() => new Date());
      return Response.json(
        responseEnvelope(activityStreamSummariesDTOSchema).parse(
          makeEnvelope(
            { summaries: reads.map(toActivityStreamSummaryDTO) },
            now(),
          ),
        ),
        { headers },
      );
    } catch (error) {
      if (error instanceof ActivityStreamsUnavailableError)
        return fail(404, 'activity_unavailable', 'The account is unavailable.');
      deps.onError?.(error, requestId);
      return fail(500, 'internal_error', 'The request could not be completed.');
    }
  };
}
