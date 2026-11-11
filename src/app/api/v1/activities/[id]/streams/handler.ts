import {
  activityCompactStreamSummaryDTOSchema,
  activityStreamSummaryDTOSchema,
  activityStreamsDTOSchema,
  toActivityStreamSummaryDTO,
  toActivityStreamsDTO,
  toCompactStreamSummaryDTO,
} from '~/contracts/v1/activity-streams';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { PRIVATE_API_HEADERS, apiFailure } from '~/server/api/transport';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';
import {
  type ActivityStreamsRepository,
  ActivityStreamsUnavailableError,
} from '~/server/repositories/activity-streams';

export function createActivityStreamsHandler(deps: {
  resolveActor: (request: Request) => Promise<Actor | null>;
  /** The account's stored recordings. A recording is fetched by the
   * library's own jobs, never by this request. */
  repository: ActivityStreamsRepository;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /** `summary` serves the downsampled streams instead of the raw samples. */
  view?: 'raw' | 'summary' | 'compact';
}) {
  return async (request: Request, id: string | null): Promise<Response> => {
    const requestId = requestIdFor(request);
    const headers = {
      ...PRIVATE_API_HEADERS,
    };
    const fail = (
      status: number,
      code: string,
      message: string,
      retryable = false,
      retryAfter?: number,
    ) =>
      apiFailure(requestId, status, code, message, {
        retryable,
        retryAfterSeconds: retryAfter,
      });
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        return fail(401, 'not_authenticated', 'Authentication is required.');
      const url = new URL(request.url);
      // Accepted for clients that still send them; neither starts a fetch.
      const fetchMode = url.searchParams.get('fetch') ?? 'auto';
      const refresh = url.searchParams.get('refresh') ?? 'false';
      if (
        id === null ||
        !['auto', 'none'].includes(fetchMode) ||
        !['true', 'false'].includes(refresh) ||
        (fetchMode === 'none' && refresh === 'true')
      ) {
        return fail(
          400,
          'validation_failed',
          'Invalid activity ID or stream query.',
        );
      }
      const now = deps.now ?? (() => new Date());
      type Stored = ActivityStreamsRepository;
      const summaryResponse = (
        read: Awaited<ReturnType<Stored['readSummaries']>>[number],
        init: ResponseInit,
      ) =>
        Response.json(
          responseEnvelope(
            deps.view === 'compact'
              ? activityCompactStreamSummaryDTOSchema
              : activityStreamSummaryDTOSchema,
          ).parse(
            makeEnvelope(
              deps.view === 'compact'
                ? toCompactStreamSummaryDTO(read)
                : toActivityStreamSummaryDTO(read),
              now(),
            ),
          ),
          init,
        );
      const rawResponse = (
        row: Awaited<ReturnType<Stored['read']>>,
        init: ResponseInit,
      ) =>
        Response.json(
          responseEnvelope(activityStreamsDTOSchema).parse(
            makeEnvelope(toActivityStreamsDTO(id, row), now()),
          ),
          init,
        );
      const init = { status: 200, headers };
      if (deps.view === 'summary' || deps.view === 'compact') {
        const [read] = await deps.repository.readSummaries(actor, [id]);
        if (!read) throw new ActivityStreamsUnavailableError();
        return summaryResponse(read, init);
      }
      const row = await deps.repository.read(actor, id);
      return rawResponse(row, init);
    } catch (error) {
      if (error instanceof ActivityStreamsUnavailableError)
        return fail(
          404,
          'activity_unavailable',
          'The activity is unavailable.',
        );
      deps.onError?.(error, requestId);
      return fail(
        500,
        'internal_error',
        'The request could not be completed.',
        true,
      );
    }
  };
}
