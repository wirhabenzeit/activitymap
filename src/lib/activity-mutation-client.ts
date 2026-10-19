import type { z } from 'zod';

import { activityDTOSchema } from '~/contracts/v1/activity';
import {
  type UpdateActivityRequest,
  activityRefreshResultSchema,
  updateActivityRequestSchema,
} from '~/contracts/v1/activity-mutations';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';
import { message } from '~/lib/presentation/messages';

export class ActivityCommandError extends Error {
  constructor(
    message: string,
    readonly facts: {
      status: number;
      code: string;
      requestId: string | null;
      retryable: boolean;
      retryAt: number | null;
      details?: unknown;
    },
  ) {
    super(message);
  }

  get requiresRefresh(): boolean {
    const details = this.facts.details;
    return (
      typeof details === 'object' &&
      details !== null &&
      (('upstreamSucceeded' in details && details.upstreamSucceeded === true) ||
        ('recovery' in details && details.recovery === 'refresh_before_retry'))
    );
  }
}

type Fetch = typeof fetch;
async function request<T>(
  id: number,
  suffix: string,
  method: string,
  schema: z.ZodType<T>,
  body: unknown,
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`/api/v1/activities/${id}${suffix}`, {
    method,
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => null);
  signal?.throwIfAborted();
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(json);
    const retry = response.headers.get('retry-after');
    const retryAt =
      retry === null
        ? null
        : /^\d+$/.test(retry)
          ? Date.now() + Number(retry) * 1000
          : Date.parse(retry);
    throw new ActivityCommandError(
      parsed.success
        ? parsed.data.error.message
        : message('error.activity.requestFailed'),
      {
        status: response.status,
        code: parsed.success ? parsed.data.error.code : 'invalid_response',
        requestId:
          response.headers.get('x-request-id') ??
          (parsed.success ? parsed.data.error.requestId : null),
        retryable: parsed.success ? parsed.data.error.retryable : false,
        retryAt: retryAt !== null && Number.isFinite(retryAt) ? retryAt : null,
        details: parsed.success ? parsed.data.error.details : undefined,
      },
    );
  }
  const parsed = responseEnvelope(schema).safeParse(json);
  if (!parsed.success)
    throw new ActivityCommandError(
      message(
        method === 'PATCH'
          ? 'error.activity.invalidResponse'
          : 'mutation.refreshError.description',
      ),
      {
        status: response.status,
        code: 'invalid_response',
        requestId: response.headers.get('x-request-id'),
        retryable: false,
        retryAt: null,
        details:
          method === 'PATCH' ? { recovery: 'refresh_before_retry' } : undefined,
      },
    );
  return parsed.data.data;
}

export const saveActivityCommand = (
  id: number,
  changes: UpdateActivityRequest,
  signal?: AbortSignal,
  fetchImpl?: Fetch,
) =>
  request(
    id,
    '',
    'PATCH',
    activityDTOSchema.refine((activity) => activity.id === String(id)),
    updateActivityRequestSchema.parse(changes),
    signal,
    fetchImpl,
  );
export const refreshActivityCommand = (
  id: number,
  signal?: AbortSignal,
  fetchImpl?: Fetch,
) =>
  request(
    id,
    '/refresh',
    'POST',
    activityRefreshResultSchema.refine(
      (result) => result.activity.id === String(id),
    ),
    undefined,
    signal,
    fetchImpl,
  );
