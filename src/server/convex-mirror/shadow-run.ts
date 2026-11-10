import 'server-only';

import { eq } from 'drizzle-orm';

import { externalEffectsEnabled } from '~/server/config/external-effects';
import { db } from '~/server/db';
import { users } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import { mirrorCatalogue } from './catalogue';
import { postgresCatalogueSource } from './catalogue-source';
import { mirrorOwner } from './mirror';
import {
  postgresMirrorSource,
  shadowActor,
  uploadFile,
  uploadRecording,
} from './postgres-source';
import { shadowOwners } from './shadow-owners';
import { createShadowMirrorTrigger } from './trigger';

/** Shadow owners, or null when shadow writes are off: owners must be listed
 * explicitly and automated external effects enabled for this deployment. */
export function configuredShadowOwners(): string[] | null {
  return externalEffectsEnabled()
    ? shadowOwners(process.env.ACTIVITYMAP_CONVEX_SHADOW_OWNERS)
    : null;
}

/** One mirror run for a shadow owner (scheduled job and write trigger). */
export async function runShadowMirror(userId: string, deadline: number) {
  const actor = await shadowActor(userId);
  const writer = convexWriteBridge(actor);
  if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  const result = await mirrorOwner({
    source: postgresMirrorSource(actor),
    writer,
    upload: uploadRecording,
    deadline,
  });
  logger.info('Convex shadow write', { userId, ...result });
  return result;
}

/** Continue copying the place catalogue to Convex. The catalogue belongs to
 * no owner; `userId` only names whose bridge scope signs the requests. */
export async function runCatalogueMirror(userId: string, deadline: number) {
  const writer = convexWriteBridge(await shadowActor(userId));
  if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  const result = await mirrorCatalogue({
    source: postgresCatalogueSource(),
    writer,
    upload: uploadFile,
    deadline,
  });
  if (result.sent > 0 || !result.complete)
    logger.info('Convex catalogue copy', result);
  return result;
}

const onError = (error: unknown, userId: string) =>
  logger.error('Convex shadow write failed', { error, userId });

/** Mirror a shadow owner after a write to Postgres. Never rejects; a no-op
 * for everyone else. Call it from `after()`, once the write has committed. */
export const mirrorShadowOwnerAfterWrite = createShadowMirrorTrigger({
  owners: configuredShadowOwners,
  run: runShadowMirror,
  onError,
});

/** The same for a Strava athlete ID (webhook events). Looks the user up only
 * when shadow writes are configured. */
export async function mirrorShadowAthleteAfterWrite(athleteId: number) {
  try {
    if (!configuredShadowOwners()?.length) return;
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.athlete_id, athleteId));
    if (user) await mirrorShadowOwnerAfterWrite(user.id);
  } catch (error) {
    onError(error, `athlete:${athleteId}`);
  }
}
