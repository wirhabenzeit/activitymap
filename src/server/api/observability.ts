import { randomUUID } from 'node:crypto';

import { errorEnvelope } from '~/contracts/v1/error';
import { logger } from '~/server/logging/logger';
import { requestIdFor, withRequestIdHeader } from '~/server/http/request-id';

export interface ApiV1ObservabilityOptions {
  /** A human-readable `"METHOD /path"` label used as the log line's `route` field. */
  route: string;
  now?: () => number;
  createRequestId?: () => string;
}

/**
 * Wraps a `/api/v1/*` Route Handler with request-id propagation and API
 * latency/error-rate logging (issue #127).
 *
 * **Request id**: resolved once here (the caller's own `x-request-id`
 * header if present, otherwise a fresh one - see
 * `~/server/http/request-id.ts`) and injected into the request passed to
 * the inner handler, so that handler's own `requestIdFor` call (every v1
 * handler already has one, e.g. `~/app/api/v1/me/handler.ts`) resolves to
 * this *same* id without any change to the handler's signature. The id is
 * therefore identical across: the structured log line this wrapper emits,
 * every log line the inner handler's own `onError` emits, and the
 * `error.requestId` field in any error envelope the handler returns - so a
 * client that reports "my request X failed" can be traced through all of
 * them. It is also echoed back as an `X-Request-Id` response header on
 * every response, success or failure.
 *
 * **Metrics**: this codebase has no metrics backend (the same
 * already-established fact `~/server/strava/webhook-drain.ts`'s
 * `getWebhookInboxMetrics` documents for webhook backlog/dead-letter/
 * sync-lag) - so, for consistency, API latency and status are recorded the
 * same way: one structured `logger.info`/`logger.warn` line per request,
 * `{ route, method, status, durationMs, requestId }`. A `5xx` response
 * logs at `warn` (not `error`) here, since the inner handler's own
 * `onError` already logs the underlying error at `error` level with full
 * context; this line is purely the aggregate latency/status signal.
 */
export function withApiV1Observability(
  handler: (request: Request) => Promise<Response>,
  options: ApiV1ObservabilityOptions,
) {
  const now = options.now ?? (() => performance.now());
  const createRequestId = options.createRequestId ?? randomUUID;

  return async function observed(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);
    const taggedRequest = await withRequestIdHeader(request, requestId);
    const startedAt = now();

    let response: Response;
    try {
      response = await handler(taggedRequest);
    } catch (error) {
      // Defense in depth: every v1 handler already catches its own errors
      // and returns a 500 envelope, so this branch should be unreachable
      // in practice. It exists so an unexpected throw still produces a
      // valid, tagged error response and a logged metric line instead of
      // an unhandled rejection.
      const durationMs = Math.round(now() - startedAt);
      logger.error('[ApiV1] request threw unexpectedly', {
        route: options.route,
        method: request.method,
        durationMs,
        requestId,
        error,
      });
      return tagResponse(
        Response.json(
          errorEnvelope('internal_error', 'The request could not be completed.', {
            requestId,
            retryable: true,
          }),
          { status: 500 },
        ),
        requestId,
      );
    }

    const durationMs = Math.round(now() - startedAt);
    const logLine = {
      route: options.route,
      method: request.method,
      status: response.status,
      durationMs,
      requestId,
    };
    if (response.status >= 500) {
      logger.warn('[ApiV1] request completed with a server error', logLine);
    } else {
      logger.info('[ApiV1] request completed', logLine);
    }

    return tagResponse(response, requestId);
  };
}

function tagResponse(response: Response, requestId: string): Response {
  if (response.headers.has('x-request-id')) return response;
  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
