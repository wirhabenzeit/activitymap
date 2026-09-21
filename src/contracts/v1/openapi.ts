import { z } from 'zod';
import { SCHEMA_VERSION } from './primitives';
import { authenticationDTOSchema } from './auth';
import { activityDTOSchema } from './activity';
import { photoDTOSchema } from './photo';
import { currentUserDTOSchema } from './user';
import { syncBootstrapPageDTOSchema, syncChangesPageDTOSchema } from './sync';
import { errorEnvelopeSchema } from './error';
import { responseEnvelope } from './envelope';
import { paginatedSchema, MAX_PAGE_SIZE } from './pagination';
import {
  mobileExchangeRequestSchema,
  mobileExchangeResponseDTOSchema,
  mobileSessionListDTOSchema,
  revokeSessionRequestSchema,
} from './mobile-auth';

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
  registry.add(responseEnvelope(syncBootstrapPageDTOSchema), {
    id: 'SyncBootstrapPageResponse',
  });
  registry.add(responseEnvelope(syncChangesPageDTOSchema), {
    id: 'SyncChangesPageResponse',
  });
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
  registry.add(mobileExchangeRequestSchema, { id: 'MobileExchangeRequest' });
  registry.add(responseEnvelope(mobileExchangeResponseDTOSchema), {
    id: 'MobileExchangeResponse',
  });
  registry.add(responseEnvelope(mobileSessionListDTOSchema), {
    id: 'MobileSessionListResponse',
  });
  registry.add(revokeSessionRequestSchema, { id: 'RevokeSessionRequest' });

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
            '429': errorResponse('Too many requests; see `Retry-After`'),
            '500': errorResponse(
              'The server could not serialize a valid contract response',
            ),
          },
        },
      },
      '/api/v1/sync/bootstrap': {
        get: {
          operationId: 'syncBootstrap',
          summary: "Paginated snapshot of the caller's activities or photos",
          description:
            'Stable keyset pagination, never offset - see docs/swiftui-backend-preparation-plan.md, "Synchronization protocol". Page through `resource=activities` (the default) until `nextCursor` is null, then repeat with `resource=photos`. The first page of a bootstrap run (no `cursor`) returns `snapshotCursor`, the change-feed high-water mark at that moment; once every page has been applied locally, call `/api/v1/sync/changes?cursor=<snapshotCursor>` to catch anything that changed during bootstrap.',
          security,
          parameters: [
            {
              name: 'resource',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['activities', 'photos'] },
              description: 'Which entity type to page through (default `activities`)',
            },
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
              description: 'A page of the bootstrap snapshot',
              content: {
                'application/json': { schema: ref('SyncBootstrapPageResponse') },
              },
            },
            '400': errorResponse(
              'The `resource`, `cursor`, or `limit` parameter is invalid',
            ),
            '401': errorResponse(
              'No valid session or bearer credential was presented',
            ),
            '429': errorResponse('Too many requests; see `Retry-After`'),
          },
        },
      },
      '/api/v1/sync/changes': {
        get: {
          operationId: 'syncChanges',
          summary: 'Ordered activity/photo upserts and deletions after a cursor',
          description:
            'Never driven by `changed_at` - always by `sync_change.sequence` - so no change can be skipped or duplicated at a page boundary. See docs/swiftui-backend-preparation-plan.md, "Delta synchronization". Safe to replay: applying the same page twice, or resuming after an interruption with the last cursor a client actually committed, produces the same end state.',
          security,
          parameters: [
            {
              name: 'cursor',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description:
                'Opaque cursor from a prior bootstrap `snapshotCursor` or a prior changes page `nextCursor`',
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
              description: 'Maximum number of changes to return',
            },
          ],
          responses: {
            '200': {
              description: 'A page of changes after the given cursor',
              content: {
                'application/json': { schema: ref('SyncChangesPageResponse') },
              },
            },
            '400': errorResponse('The `cursor` or `limit` parameter is invalid'),
            '401': errorResponse(
              'No valid session or bearer credential was presented',
            ),
            '409': errorResponse(
              'The cursor is malformed, unsupported, or older than the retained change history (`sync_rebootstrap_required`); call `/api/v1/sync/bootstrap` again',
            ),
            '429': errorResponse('Too many requests; see `Retry-After`'),
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
      '/api/v1/auth/mobile/start': {
        get: {
          operationId: 'startMobileAuth',
          summary: 'Start the mobile Strava sign-in flow',
          description:
            'Opened by `ASWebAuthenticationSession`. Starts the existing server-side Strava OAuth flow and, on completion, redirects to `redirect_uri` (which must be allow-listed) with a one-time code and the original `state` - never a session credential. See issue #121.',
          parameters: [
            {
              name: 'state',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Client-generated CSRF state, echoed back on the final redirect',
            },
            {
              name: 'code_challenge',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'RFC 7636 PKCE S256 challenge',
            },
            {
              name: 'redirect_uri',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'The allow-listed universal link to redirect to once sign-in completes',
            },
          ],
          responses: {
            '302': { description: 'Redirect to the Strava authorization URL' },
            '400': errorResponse(
              'A required parameter is missing, or `redirect_uri` is not allow-listed',
            ),
            '429': errorResponse('Too many requests; see `Retry-After`'),
            '500': errorResponse('Starting the Strava sign-in flow failed'),
          },
        },
      },
      '/api/v1/auth/mobile/callback': {
        get: {
          operationId: 'mobileAuthCallback',
          summary: "Strava's OAuth callback, redirected here for a mobile sign-in",
          description:
            'Not called directly by a client. Mints a one-time login code bound to the just-completed browser session and redirects to the mobile universal link with that code and the original `state`.',
          responses: {
            '302': {
              description: 'Redirect to the mobile universal link with a one-time code',
            },
            '400': errorResponse(
              'A required parameter is missing, or `redirect_uri` is not allow-listed',
            ),
            '401': errorResponse('The Strava sign-in did not produce a session'),
            '429': errorResponse('Too many requests; see `Retry-After`'),
            '500': errorResponse('The request could not be completed'),
          },
        },
      },
      '/api/v1/auth/mobile/exchange': {
        post: {
          operationId: 'exchangeMobileLoginCode',
          summary: 'Exchange a one-time mobile login code for a bearer session token',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: ref('MobileExchangeRequest') },
            },
          },
          responses: {
            '200': {
              description: 'The ActivityMap bearer session token',
              content: {
                'application/json': { schema: ref('MobileExchangeResponse') },
              },
            },
            '400': errorResponse('The request body is invalid'),
            '401': errorResponse(
              'The code is invalid, expired, already used, or its state/PKCE verifier does not match',
            ),
            '429': errorResponse('Too many requests; see `Retry-After`'),
          },
        },
      },
      '/api/v1/auth/logout': {
        post: {
          operationId: 'logout',
          summary: "Revoke the caller's current session",
          security,
          responses: {
            '200': { description: 'The session was revoked' },
            '401': errorResponse(
              'No valid session or bearer credential was presented',
            ),
            '429': errorResponse('Too many requests; see `Retry-After`'),
          },
        },
      },
      '/api/v1/auth/sessions': {
        get: {
          operationId: 'listSessions',
          summary: "List the caller's active sessions",
          security,
          responses: {
            '200': {
              description: 'The active sessions for the current user',
              content: {
                'application/json': { schema: ref('MobileSessionListResponse') },
              },
            },
            '401': errorResponse(
              'No valid session or bearer credential was presented',
            ),
            '429': errorResponse('Too many requests; see `Retry-After`'),
          },
        },
      },
      '/api/v1/auth/sessions/revoke': {
        post: {
          operationId: 'revokeSession',
          summary: 'Revoke one of the caller\'s own sessions by token (per-device sign-out)',
          security,
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: ref('RevokeSessionRequest') },
            },
          },
          responses: {
            '200': { description: 'The session was revoked' },
            '400': errorResponse('The request body is invalid'),
            '401': errorResponse(
              'No valid session or bearer credential was presented',
            ),
            '429': errorResponse('Too many requests; see `Retry-After`'),
          },
        },
      },
    },
  } as const;
}
