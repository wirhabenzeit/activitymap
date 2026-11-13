import 'server-only';

/** Native/web live sync is available for an account with a stored Convex
 * assignment and a configured public deployment URL. Query authorization still
 * derives the owner from its JWT; configuration never grants data access. */
export function convexLiveUrlFor(
  user: { writer?: string | null; convexEpoch?: string | null },
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const url = environment.ACTIVITYMAP_CONVEX_URL?.trim();
  return user.writer === 'convex' &&
    user.convexEpoch &&
    url &&
    /^https:\/\/[a-z0-9.-]+$/.test(url)
    ? url
    : null;
}
