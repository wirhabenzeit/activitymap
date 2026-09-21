import { randomUUID } from 'node:crypto';

/**
 * Resolve the request id for a `/api/v1/*` request: the caller-supplied
 * `x-request-id` header if present (so a client-generated id round-trips
 * for correlating its own logs with ours), otherwise a freshly generated
 * one. Every v1 handler's own `requestIdFor` (see e.g.
 * `~/app/api/v1/me/handler.ts`) implements exactly this same rule; this is
 * the shared, single source of truth for it (issue #127).
 */
export function requestIdFor(
  request: Request,
  createRequestId: () => string = randomUUID,
): string {
  const suppliedRequestId = request.headers.get('x-request-id')?.trim();
  if (suppliedRequestId) return suppliedRequestId;
  return createRequestId();
}

/**
 * Returns a shallow clone of `request` with its `x-request-id` header set
 * to `requestId` - used at the `/api/v1/*` boundary
 * (`~/server/api/observability.ts`) so every downstream handler's own
 * `requestIdFor` call (reading the header) resolves to the exact same id
 * the boundary already logged, without threading it through every
 * function signature in between.
 *
 * `Request` bodies are single-use streams, so a non-`GET`/`HEAD` request's
 * body is read once here and passed through as a buffer rather than
 * reusing the original (already-locked) body stream.
 */
export async function withRequestIdHeader(
  request: Request,
  requestId: string,
): Promise<Request> {
  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit = { method: request.method, headers };
  if (hasBody) {
    init.body = await request.arrayBuffer();
  }
  return new Request(request.url, init);
}
