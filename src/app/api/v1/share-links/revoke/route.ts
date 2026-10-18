import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { createShareLinksHandler } from '../handler';
import { shareLinkDependencies } from '../dependencies';

export const POST = withApiV1Observability(
  withApiV1RateLimit(createShareLinksHandler(shareLinkDependencies, 'revoke'), {
    route: 'POST /api/v1/share-links/revoke',
    resolveUserId: resolveRateLimitUserId,
  }),
  { route: 'POST /api/v1/share-links/revoke' },
);
