import { toAuthenticationDTO } from '~/contracts/v1/auth';
import { toCurrentUserDTOv1 } from '~/contracts/v1/user';
import { stravaPermissionsFromScope } from '~/lib/strava-permissions';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { db } from '~/server/db';
import { logger } from '~/server/logging/logger';

import { createCurrentUserHandler } from './handler';

const ROUTE = 'GET /api/v1/me';

export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createCurrentUserHandler({
      resolveCurrentUser: async (request) => {
        const session = await context.session();
        if (!session?.user?.id) return null;

        const [user, account] = await Promise.all([
          db.query.users.findFirst({
            where: (users, { eq }) => eq(users.id, session.user.id),
          }),
          db.query.accounts.findFirst({
            columns: { access_token: true, accessToken: true, scope: true },
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
            stravaPermissions: stravaPermissionsFromScope(account?.scope),
          },
          authentication,
        );
      },
      onError: (error, requestId) => {
        logger.error('GET /api/v1/me failed', { error, requestId });
      },
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
