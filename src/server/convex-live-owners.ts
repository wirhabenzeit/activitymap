import 'server-only';

import { z } from 'zod';

import { logger } from '~/server/logging/logger';

const ownersSchema = z.array(z.string().min(1).max(128)).max(50);

/**
 * Owners whose web client loads its library through live Convex queries while
 * everything else stays on Postgres (docs/convex-reactive-reads.md).
 *
 * `ACTIVITYMAP_CONVEX_LIVE_OWNERS` is a JSON array of application user IDs and
 * `ACTIVITYMAP_CONVEX_URL` the Convex deployment their browser subscribes to.
 * Unlike a preview owner (`src/server/preview/selection.ts`), a live owner is
 * an ordinary account: edits, photos, charts and status use the usual routes,
 * and only the library download changes. The owner must be mirrored into that
 * deployment (`ACTIVITYMAP_CONVEX_SHADOW_OWNERS`); if Convex does not serve
 * them, the client falls back to the REST sync.
 *
 * Returns the deployment URL for a live owner, else null. Unset or invalid
 * configuration turns the feature off rather than failing the app shell.
 */
export function convexLiveUrl(
  userId: string,
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const url = environment.ACTIVITYMAP_CONVEX_URL?.trim();
  const owners = environment.ACTIVITYMAP_CONVEX_LIVE_OWNERS;
  if (!url || !owners) return null;
  let parsed;
  try {
    parsed = ownersSchema.safeParse(JSON.parse(owners));
  } catch {
    parsed = null;
  }
  if (!parsed?.success || !/^https:\/\/[a-z0-9.-]+$/.test(url)) {
    logger.error('Invalid Convex live owner configuration; live reads off.');
    return null;
  }
  return parsed.data.includes(userId) ? url : null;
}

/** The deployment an account's browser subscribes to: any account Convex
 * writes for, and the accounts listed as live owners. */
export function convexLiveUrlFor(
  user: { id: string; writer?: string | null; convexEpoch?: string | null },
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const url = environment.ACTIVITYMAP_CONVEX_URL?.trim();
  if (
    user.writer === 'convex' &&
    user.convexEpoch &&
    url &&
    /^https:\/\/[a-z0-9.-]+$/.test(url)
  )
    return url;
  return convexLiveUrl(user.id, environment);
}
