import { ZodError } from 'zod';

import { makeEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  createShareLinkRequestSchema,
  createdShareLinkDTOSchema,
  revokeShareLinkRequestSchema,
  revokeShareLinkResultSchema,
  shareLinkListDTOSchema,
} from '~/contracts/v1/share-links';
import {
  PRIVATE_API_HEADERS,
  mutationOriginAllowed,
} from '~/server/api/transport';
import {
  ForbiddenError,
  ShareLinkNotFoundError,
  type createShareLinkForActor,
  type listShareLinksForActor,
  type revokeShareLinkForActor,
} from '~/server/application/share-links';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';

type Dependencies = {
  resolveActor: (request: Request) => Promise<Actor | null>;
  create: typeof createShareLinkForActor;
  list: typeof listShareLinksForActor;
  revoke: typeof revokeShareLinkForActor;
};

const headers = {
  ...PRIVATE_API_HEADERS,
  'Referrer-Policy': 'no-referrer',
};

export function createShareLinksHandler(
  deps: Dependencies,
  operation: 'create' | 'list' | 'revoke',
) {
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFor(request);
    const failure = (status: number, code: string, message: string) =>
      Response.json(errorEnvelope(code, message, { requestId }), {
        status,
        headers,
      });
    try {
      const actor = await deps.resolveActor(request);
      if (!actor)
        return failure(401, 'not_authenticated', 'Authentication is required.');
      if (
        operation !== 'list' &&
        !mutationOriginAllowed(request, 'if-present')
      ) {
        return failure(403, 'forbidden', 'The request origin is not allowed.');
      }
      if (operation === 'list') {
        const links = await deps.list(actor);
        const data = shareLinkListDTOSchema.parse({
          links: links.map((link) => ({
            id: link.id,
            createdAt: link.createdAt.toISOString(),
            expiresAt: link.expiresAt.toISOString(),
            revokedAt: link.revokedAt?.toISOString() ?? null,
            fields: link.fields,
            activityCount: link.activityCount,
            status: link.status,
          })),
        });
        return Response.json(makeEnvelope(data), { headers });
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return failure(400, 'validation_failed', 'Request body must be JSON.');
      }
      if (operation === 'revoke') {
        const parsed = revokeShareLinkRequestSchema.safeParse(body);
        if (!parsed.success)
          return failure(
            400,
            'validation_failed',
            'A valid share link ID is required.',
          );
        await deps.revoke(actor, parsed.data.id);
        return Response.json(
          makeEnvelope(
            revokeShareLinkResultSchema.parse({ status: 'revoked' }),
          ),
          { headers },
        );
      }
      const parsed = createShareLinkRequestSchema.safeParse(body);
      if (!parsed.success)
        return failure(
          400,
          'validation_failed',
          'Choose 1–200 activities and an expiry between 1 hour and 30 days.',
        );
      const link = await deps.create(actor, {
        ...parsed.data,
        activityIds: parsed.data.activityIds.map(Number),
      });
      const data = createdShareLinkDTOSchema.parse({
        id: link.id,
        token: link.token,
        expiresAt: link.expiresAt.toISOString(),
      });
      return Response.json(makeEnvelope(data), { status: 201, headers });
    } catch (error) {
      if (error instanceof ForbiddenError)
        return failure(403, 'forbidden', error.message);
      if (error instanceof ShareLinkNotFoundError)
        return failure(404, 'not_found', error.message);
      if (error instanceof ZodError)
        return failure(
          500,
          'internal_error',
          'The share response could not be prepared.',
        );
      // Never log input, capability tokens, or errors that may contain them.
      return failure(
        500,
        'internal_error',
        'The share request could not be completed.',
      );
    }
  };
}
