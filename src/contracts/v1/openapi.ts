import { z } from 'zod';
import { SCHEMA_VERSION } from './primitives';
import { authenticationDTOSchema } from './auth';
import { activityDTOSchema } from './activity';
import { photoDTOSchema } from './photo';
import { currentUserDTOSchema } from './user';
import { offlineSyncPayloadDTOSchema } from './sync';
import { errorEnvelopeSchema } from './error';
import { responseEnvelope } from './envelope';
import { paginatedSchema, MAX_PAGE_SIZE } from './pagination';

/**
 * Builds the v1 OpenAPI 3.1 document from the same Zod schemas the route
 * handlers validate against, so the checked-in document and the runtime
 * contract cannot drift silently (see issue #119).
 *
 * `/api/v1/me` is the first live boundary using this contract. The activity,
 * photo, and sync operations remain contract-first until their corresponding
 * versioned routes land.
 */
export function buildOpenApiDocument() {
  const registry = z.registry<{ id: string }>();
  registry.add(authenticationDTOSchema, { id: 'Authentication' });
  registry.add(currentUserDTOSchema, { id: 'CurrentUser' });
  registry.add(activityDTOSchema, { id: 'Activity' });
  registry.add(photoDTOSchema, { id: 'Photo' });
  registry.add(offlineSyncPayloadDTOSchema, { id: 'OfflineSyncPayload' });
  registry.add(errorEnvelopeSchema, { id: 'FailureResponse' });
  registry.add(responseEnvelope(currentUserDTOSchema), {
    id: 'CurrentUserResponse',
  });
  registry.add(responseEnvelope(paginatedSchema(activityDTOSchema)), {
    id: 'ActivityPageResponse',
  });
  registry.add(responseEnvelope(paginatedSchema(photoDTOSchema)), {
    id: 'PhotoPageResponse',
  });

  const { schemas: rawSchemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    uri: (id) => `#/components/schemas/${id}`,
  });

  // OpenAPI's `components.schemas` entries are referenced by their map key,
  // not by a JSON Schema `$id`/`$schema` pair, so strip those before
  // embedding — keeping them risks confusing a resolver that treats `$id`
  // as declaring a new base URI.
  const schemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(rawSchemas)) {
    const { $id, $schema, ...rest } = schema as Record<string, unknown>;
    void $id;
    void $schema;
    schemas[name] = rest;
  }

  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

  const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: ref('FailureResponse') } },
  });

  const security = [{ cookieAuth: [] }, { bearerAuth: [] }];

  return {
    openapi: '3.1.0',
    info: {
      title: 'ActivityMap API',
      version: `v${SCHEMA_VERSION}`,
    },
    components: {
      schemas,
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'The existing web session cookie (see issue #117).',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'An ActivityMap-issued bearer credential, exchanged per issue #121. Never a Strava token.',
        },
      },
    },
    paths: {
      '/api/v1/me': {
        get: {
          operationId: 'getCurrentUser',
          summary: 'Get the authenticated user',
          security,
          responses: {
            '200': {
              description: 'The current user',
              content: {
                'application/json': { schema: ref('CurrentUserResponse') },
              },
            },
            '401': errorResponse(
              'No valid session or bearer credential was presented',
            ),
            '500': errorResponse(
              'The server could not serialize a valid contract response',
            ),
          },
        },
      },
      '/api/v1/activities': {
        get: {
          operationId: 'listActivities',
          summary: "List the authenticated user's activities",
          security,
          parameters: [
            {
              name: 'cursor',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Opaque pagination cursor from a previous response',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: MAX_PAGE_SIZE,
              },
              description: 'Maximum number of items to return',
            },
          ],
          responses: {
            '200': {
              description: 'A page of activities',
              content: {
                'application/json': { schema: ref('ActivityPageResponse') },
              },
            },
            '400': errorResponse(
              'The `cursor` or `limit` parameter is invalid',
            ),
            '401': errorResponse(
              'No valid session or bearer credential was presented',
            ),
          },
        },
      },
      '/api/v1/photos': {
        get: {
          operationId: 'listPhotos',
          summary: "List the authenticated user's photos",
          security,
          parameters: [
            {
              name: 'cursor',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Opaque pagination cursor from a previous response',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: MAX_PAGE_SIZE,
              },
              description: 'Maximum number of items to return',
            },
          ],
          responses: {
            '200': {
              description: 'A page of photos',
              content: {
                'application/json': { schema: ref('PhotoPageResponse') },
              },
            },
            '400': errorResponse(
              'The `cursor` or `limit` parameter is invalid',
            ),
            '401': errorResponse(
              'No valid session or bearer credential was presented',
            ),
          },
        },
      },
    },
  } as const;
}
