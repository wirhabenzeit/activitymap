import 'server-only';

import { z } from 'zod';

import { logger } from '~/server/logging/logger';

const ownersSchema = z.record(
  z.string().min(1).max(128),
  z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
);

/**
 * Owners whose v1 reads are served from the Convex application backend in
 * production while Postgres stays the writer (docs/convex-writer-cutover.md,
 * step 2).
 *
 * `ACTIVITYMAP_CONVEX_READ_OWNERS` is a JSON object from application user ID
 * to the owner's current Convex epoch, for example
 * `{"<userId>": "<epoch>"}`. The epoch is the one the owner was provisioned
 * with; the bridge refuses any other, so a handoff that changes it stops
 * these reads until the setting follows.
 *
 * Unlike a preview owner (`src/server/preview/selection.ts`), a read owner is
 * an ordinary account: edits, refreshes, imports, sharing and deletion keep
 * working on Postgres, and the shadow mirror carries their results to
 * Convex. The owner must be mirrored (`ACTIVITYMAP_CONVEX_SHADOW_OWNERS`).
 *
 * Returns the epoch for a read owner, else null. Unset or invalid
 * configuration leaves every account on Postgres rather than failing reads.
 */
export function convexReadEpoch(
  userId: string,
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const owners = environment.ACTIVITYMAP_CONVEX_READ_OWNERS;
  if (!owners) return null;
  let parsed;
  try {
    parsed = ownersSchema.safeParse(JSON.parse(owners));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) {
    logger.error(
      'Invalid Convex read owner configuration; reads stay on Postgres.',
    );
    return null;
  }
  return Object.hasOwn(parsed.data, userId) ? parsed.data[userId]! : null;
}
