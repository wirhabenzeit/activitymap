import { toAuthenticationDTO } from '~/contracts/v1/auth';
import { toCurrentUserDTOv1 } from '~/contracts/v1/user';
import { auth } from '~/lib/auth';
import { resolveRequestSession } from '~/server/auth/request-session';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { db } from '~/server/db';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { createCurrentUserHandler } from './handler';

const ROUTE = 'GET /api/v1/me';

export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createCurrentUserHandler({
      resolveCurrentUser: async (request) => {
        const session = await resolveRequestSession(request, ({ headers }) =>
          auth.api.getSession({ headers }),
        );
        if (!session?.user?.id) return null;

        const [user, account] = await Promise.all([
          db.query.users.findFirst({
            where: (users, { eq }) => eq(users.id, session.user.id),
          }),
          db.query.accounts.findFirst({
            columns: { access_token: true, accessToken: true },
            where: (accounts, { and, eq }) =>
              and(
                eq(accounts.userId, session.user.id),
                eq(accounts.providerId, 'strava'),
              ),
          }),
        ]);
        if (!user) {
          throw new Error('Authenticated session has no local user');
        }

        const authentication = toAuthenticationDTO(
          request.headers.has('authorization') ? 'bearer' : 'cookie',
          new Date(session.session.expiresAt),
        );

        return toCurrentUserDTOv1(
          {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            athleteId: user.athlete_id,
            stravaConnected: Boolean(
              account?.accessToken ?? account?.access_token,
            ),
          },
          authentication,
        );
      },
      onError: (error, requestId) => {
        logger.error('GET /api/v1/me failed', { error, requestId });
      },
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
