import 'server-only';

import { auth } from '~/lib/auth';
import { resolveRequestSession } from '~/server/auth/request-session';

/** Resolve the Better Auth user id used by the global per-user rate limit. */
export async function resolveRateLimitUserId(
  request: Request,
): Promise<string | null> {
  const session = await resolveRequestSession(request, ({ headers }) =>
    auth.api.getSession({ headers }),
  );
  return session?.user?.id ?? null;
}
