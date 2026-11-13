import 'server-only';

import { convexJwtOptions } from '~/lib/auth-jwt';
import type { Actor } from '~/server/auth/actor';

import { startLibrary } from './index';

/** Advertise live sync only once the authenticated account's library is ready.
 * New accounts are provisioned before either client chooses its first transport.
 * Discovery never completes a handoff on behalf of another writer. */
export async function convexLiveUrlFor(
  user: {
    id: string;
    athlete_id: number | null;
    writer?: string | null;
    convexEpoch?: string | null;
  },
  options: {
    environment?: Record<string, string | undefined>;
    authentication?: Actor['authentication'];
    start?: (actor: Actor) => Promise<string>;
  } = {},
): Promise<string | null> {
  const environment = options.environment ?? process.env;
  const url = environment.ACTIVITYMAP_CONVEX_URL?.trim();
  if (
    !url ||
    !/^https:\/\/[a-z0-9.-]+$/.test(url) ||
    !convexJwtOptions(environment) ||
    !user.athlete_id ||
    user.writer === 'handoff'
  )
    return null;
  if (user.writer !== 'convex' || !user.convexEpoch)
    await (options.start ?? startLibrary)({
      userId: user.id,
      athleteId: user.athlete_id,
      authentication: options.authentication ?? 'cookie',
    });
  return url;
}
