import 'server-only';

import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';

import { authStoreIsConvex } from '~/server/auth/store';
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

/** Every account the mirror copies: the configured shadow owners, and the
 * accounts that have a library in Convex while Postgres still writes it
 * (an account being moved). Null when there are none or shadow writes are
 * off. */
export async function mirroredOwners(): Promise<string[] | null> {
  // Nothing is copied from Postgres once the app's records live in Convex.
  if (!externalEffectsEnabled() || authStoreIsConvex()) return null;
  const moving = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.convexEpoch), ne(users.writer, 'convex')))
    // The same order every run, so the shares are spread the same way.
    .orderBy(asc(users.id));
  const owners = new Set([
    ...(configuredShadowOwners() ?? []),
    ...moving.map((user) => user.id),
  ]);
  return owners.size > 0 ? [...owners] : null;
}

/** One mirror run for a shadow owner (scheduled job and write trigger). */
export async function runShadowMirror(userId: string, deadline: number) {
  // Postgres to Convex only while Postgres holds the library: during a
  // handoff this copy still has to reach the head, but once Convex writes
  // the direction is reversed (and Convex refuses these writes).
  const [owner] = await db
    .select({ writer: users.writer })
    .from(users)
    .where(eq(users.id, userId));
  if (owner?.writer === 'convex')
    return { skipped: 'Convex writes for this owner' } as const;
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
  owners: mirroredOwners,
  run: runShadowMirror,
  onError,
});

/** The same for a Strava athlete ID (webhook events). Looks the user up only
 * when shadow writes are configured. */
export async function mirrorShadowAthleteAfterWrite(athleteId: number) {
  try {
    if (!(await mirroredOwners())?.length) return;
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.athlete_id, athleteId));
    if (user) await mirrorShadowOwnerAfterWrite(user.id);
  } catch (error) {
    onError(error, `athlete:${athleteId}`);
  }
}
