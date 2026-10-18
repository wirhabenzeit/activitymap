import { z } from 'zod';

import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';
import {
  createdShareLinkDTOSchema,
  revokeShareLinkResultSchema,
  shareLinkListDTOSchema,
  type CreateShareLinkRequest,
} from '~/contracts/v1/share-links';

async function shareRequest<T extends z.ZodType>(
  path: string,
  schema: T,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<z.output<T>> {
  const response = await fetch(path, {
    method: options.body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: options.signal,
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const body: unknown = await response.json().catch(() => null);
  options.signal?.throwIfAborted();
  if (!response.ok) {
    const failure = errorEnvelopeSchema.safeParse(body);
    throw new Error(
      failure.success
        ? failure.data.error.message
        : 'The share request could not be completed. Please try again.',
    );
  }
  const envelope = responseEnvelope(z.unknown()).safeParse(body);
  const result = schema.safeParse(
    envelope.success ? envelope.data.data : undefined,
  );
  if (!envelope.success || !result.success) {
    // Never include response contents: creation returns a private capability token.
    throw new Error(
      'The share response could not be confirmed. Check Your links before trying again.',
    );
  }
  return result.data;
}

/** Creation is explicit and never retried automatically. Keep the returned token in UI state only. */
export function createShareLink(input: CreateShareLinkRequest) {
  return shareRequest('/api/v1/share-links', createdShareLinkDTOSchema, {
    body: input,
  });
}

export async function listMyShareLinks(signal?: AbortSignal) {
  const result = await shareRequest(
    '/api/v1/share-links',
    shareLinkListDTOSchema,
    { signal },
  );
  return result.links;
}

export async function revokeShareLink(id: string): Promise<void> {
  await shareRequest(
    '/api/v1/share-links/revoke',
    revokeShareLinkResultSchema,
    { body: { id } },
  );
}
