import { ZodError } from 'zod';

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
import {
  classifyStreamFetchFailure,
  fetchActivityStreams,
} from '~/server/application/activity-streams';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';
import {
  type ActivityStreamsRepository,
  ActivityStreamsUnavailableError,
} from '~/server/repositories/activity-streams';
import { StravaApiError } from '~/server/strava/client';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';

export function createActivityStreamsHandler(deps: {
  resolveActor: (request: Request) => Promise<Actor | null>;
  repository: ActivityStreamsRepository;
  fetch?: typeof fetchActivityStreams;
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
      let status = 200;
      if (fetchMode !== 'none') {
        const result = await (deps.fetch ?? fetchActivityStreams)(actor, id, {
          repository: deps.repository,
          force: refresh === 'true',
          now,
        });
        if (result.status === 'pending' || result.status === 'superseded')
          status = 202;
        if (result.status === 'cooldown') {
          const limited = result.snapshot.lastError?.code === 'rate_limited';
          const retry = Math.max(
            1,
            Math.ceil(
              ((result.snapshot.nextRetryAt?.getTime() ??
                now().getTime() + 60_000) -
                now().getTime()) /
                1000,
            ),
          );
          return fail(
            limited ? 429 : 503,
            limited ? 'rate_limited' : 'streams_fetch_failed',
            'The stream fetch is temporarily unavailable.',
            result.snapshot.lastError?.retryable ?? true,
            retry,
          );
        }
      }
      // Recheck access after the network request, including a revoke/delete
      // racing with the save. Never send a snapshot captured before that check.
      const responseHeaders = {
        ...headers,
        ...(status === 202 ? { 'Retry-After': '3' } : {}),
      };
      if (deps.view === 'summary' || deps.view === 'compact') {
        const [read] = await deps.repository.readSummaries(actor, [id]);
        if (!read) throw new ActivityStreamsUnavailableError();
        return Response.json(
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
          { status, headers: responseHeaders },
        );
      }
      const row = await deps.repository.read(actor, id);
      return Response.json(
        responseEnvelope(activityStreamsDTOSchema).parse(
          makeEnvelope(toActivityStreamsDTO(id, row), now()),
        ),
        {
          status,
          headers: responseHeaders,
        },
      );
    } catch (error) {
      if (error instanceof ActivityStreamsUnavailableError)
        return fail(
          404,
          'activity_unavailable',
          'The activity is unavailable.',
        );
      const failure = classifyStreamFetchFailure(error);
      if (failure.code === 'rate_limited')
        return fail(
          429,
          'rate_limited',
          'The Strava request budget is exhausted.',
          true,
          error instanceof StravaBudgetExceededError
            ? error.retryAfterSeconds
            : 60,
        );
      deps.onError?.(error, requestId);
      if (!(
        error instanceof StravaApiError ||
        error instanceof ZodError ||
        error instanceof TypeError ||
        (error instanceof Error &&
          ['AbortError', 'TimeoutError'].includes(error.name))
      )) {
        return fail(
          500,
          'internal_error',
          'The request could not be completed.',
          true,
        );
      }
      return fail(
        503,
        'streams_fetch_failed',
        'The stream request could not be completed.',
        failure.retryable,
        failure.retryable ? 60 : undefined,
      );
    }
  };
}
