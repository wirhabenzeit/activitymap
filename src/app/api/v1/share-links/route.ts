import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { createShareLinksHandler } from './handler';
import { shareLinkDependencies } from './dependencies';

export const GET = withApiV1Observability(
  withApiV1RateLimit(createShareLinksHandler(shareLinkDependencies, 'list'), {
    route: 'GET /api/v1/share-links',
    resolveUserId: resolveRateLimitUserId,
  }),
  { route: 'GET /api/v1/share-links' },
);
export const POST = withApiV1Observability(
  withApiV1RateLimit(createShareLinksHandler(shareLinkDependencies, 'create'), {
    route: 'POST /api/v1/share-links',
    resolveUserId: resolveRateLimitUserId,
  }),
  { route: 'POST /api/v1/share-links' },
);
