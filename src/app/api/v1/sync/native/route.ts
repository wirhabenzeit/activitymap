import { makeEnvelope } from '~/contracts/v1/envelope';
import { nativeSyncConfigurationSchema } from '~/contracts/v1/sync';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { findUserInternal } from '~/server/auth/users';
import { notAuthenticated } from '~/server/library';
import { convexLiveUrlFor } from '~/server/library/live-configuration';

/** Initialize an eligible account before advertising native sync. The existing
 * bearer-authenticated /api/auth/token issues
 * short-lived JWTs; no signing secrets are ever sent to the phone. A client
 * falls back to HTTP if discovery or the native query isn't deployed yet. */
export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const userId = await context.userId();
    if (!userId) return notAuthenticated(context.requestId);
    const user = await findUserInternal(userId);
    if (!user) return notAuthenticated(context.requestId);
    const url = await convexLiveUrlFor(user, {
      authentication: request.headers.has('authorization')
        ? 'bearer'
        : 'cookie',
    });
    return Response.json(
      makeEnvelope(
        nativeSyncConfigurationSchema
          .nullable()
          .parse(url ? { url, version: 1 } : null),
      ),
    );
  },
  { route: 'GET /api/v1/sync/native', cache: 'private-no-store' },
);
