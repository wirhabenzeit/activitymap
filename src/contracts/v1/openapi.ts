import { z } from 'zod';
import { SCHEMA_VERSION } from './primitives';
import { activityDTOSchema } from './activity';
import { errorEnvelopeSchema } from './error';
import { responseEnvelope } from './envelope';

/**
 * Builds the v1 OpenAPI 3.1 document from the same Zod schemas the route
 * handlers validate against, so the checked-in document and the runtime
 * contract cannot drift silently (see issue #119). Scope is intentionally
 * limited to the v1-contract endpoints that exist today; #121/#123/#126
 * add their own paths to this document as those land.
 */
export function buildOpenApiDocument() {
  const activitiesResponseSchema = responseEnvelope(
    z.object({ items: z.array(activityDTOSchema) }),
  );

  const jsonSchema = <T extends z.ZodTypeAny>(schema: T) =>
    z.toJSONSchema(schema, { target: 'draft-2020-12' });

  return {
    openapi: '3.1.0',
    info: {
      title: 'ActivityMap API',
      version: `v${SCHEMA_VERSION}`,
    },
    paths: {
      '/api/activities': {
        get: {
          summary: 'Fetch activities by id',
          parameters: [
            {
              name: 'ids',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Comma-separated list of activity ids',
            },
          ],
          responses: {
            '200': {
              description: 'The requested activities',
              content: {
                'application/json': { schema: jsonSchema(activitiesResponseSchema) },
              },
            },
            '400': {
              description: 'The `ids` parameter is missing or invalid',
              content: {
                'application/json': { schema: jsonSchema(errorEnvelopeSchema) },
              },
            },
            '500': {
              description: 'Internal error',
              content: {
                'application/json': { schema: jsonSchema(errorEnvelopeSchema) },
              },
            },
          },
        },
      },
    },
  } as const;
}
