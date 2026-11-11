import { createHash } from 'node:crypto';

import {
  type ConvexAuthRecords,
  convexAuthRecords,
} from '~/server/auth/convex-records';
import { eraseLibraryInConvex } from '~/server/convex-mirror/erase';
import { logger } from '~/server/logging/logger';
import { sendEventToConvex } from '~/server/sync/convex-events';
import type { WebhookRequest } from '~/types/strava';

/**
 * Strava webhooks when the app's records live in Convex
 * (`~/server/auth/store.ts`). There is no inbox in between: an activity
 * event is recorded in Convex before Strava is answered, so an event Convex
 * could not take is answered with an error and Strava delivers it again;
 * the reconciliation sweep finds what is still missed. A deauthorization
 * removes the athlete's tokens and schedules the account's erasure.
 */

/** How long after access is withdrawn the account is erased. */
export const ERASURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** One delivery's identity, the same for every repeat of it. */
function deliveryId(data: WebhookRequest) {
  return createHash('sha256')
    .update(
      [
        data.subscription_id,
        data.object_type,
        data.object_id,
        data.aspect_type,
        data.event_time,
      ].join(':'),
    )
    .digest('base64url');
}

export type ConvexWebhookDeps = {
  records?: ConvexAuthRecords;
  send?: typeof sendEventToConvex;
  now?: () => Date;
};

/** What became of one delivery. Throws when it must be delivered again. */
export async function handleWebhookOnConvex(
  data: WebhookRequest,
  deps: ConvexWebhookDeps = {},
): Promise<'recorded' | 'revoked' | 'ignored'> {
  const records = deps.records ?? convexAuthRecords();
  const account = await records.accountByAthlete(data.owner_id);
  if (!account) return 'ignored';

  if (data.object_type === 'athlete') {
    // Strava documents one athlete event: access withdrawn.
    if (data.aspect_type !== 'update' || data.updates?.authorized !== 'false')
      return 'ignored';
    const now = (deps.now ?? (() => new Date()))();
    const revoked = await records.revokeAccount(
      account.id,
      now,
      new Date(now.getTime() + ERASURE_WINDOW_MS),
    );
    return revoked ? 'revoked' : 'ignored';
  }

  if (
    data.aspect_type !== 'create' &&
    data.aspect_type !== 'update' &&
    data.aspect_type !== 'delete'
  )
    return 'ignored';
  const user = await records.user(account.userId);
  // Signed up, and the library has not been started yet: its first sweep
  // reads everything.
  if (user?.writer !== 'convex') return 'ignored';
  await (deps.send ?? sendEventToConvex)(
    { userId: user.id, athleteId: data.owner_id },
    {
      event: deliveryId(data),
      activityId: String(data.object_id),
      aspect: data.aspect_type,
      eventTime: data.event_time * 1000,
    },
  );
  return 'recorded';
}

export type ConvexErasureResult = {
  candidates: number;
  erased: number;
  cancelled: number;
  failed: number;
};

/**
 * Erase the accounts whose access was withdrawn long enough ago: the
 * library in Convex first, then the sign-in records. An account that has
 * credentials again is kept. One failure does not stop the others; a failed
 * account is a candidate again on the next run.
 */
export async function eraseDueAccountsOnConvex(
  deps: {
    records?: ConvexAuthRecords;
    eraseLibrary?: typeof eraseLibraryInConvex;
    now?: Date;
    batchSize?: number;
  } = {},
): Promise<ConvexErasureResult> {
  const records = deps.records ?? convexAuthRecords();
  const due = await records.dueErasures(
    deps.now ?? new Date(),
    deps.batchSize ?? 25,
  );
  const result = { candidates: due.length, erased: 0, cancelled: 0, failed: 0 };
  for (const account of due) {
    try {
      if (account.accessToken ?? account.refreshToken) {
        await records.cancelErasure(account.id);
        result.cancelled++;
        continue;
      }
      await deleteAccountOnConvex(account.userId, {
        records,
        eraseLibrary: deps.eraseLibrary,
      });
      result.erased++;
    } catch (error) {
      result.failed++;
      logger.error('[Erasure] Failed to erase one due account', error);
    }
  }
  return result;
}

/** Erase a user: the library in Convex, then everything the sign-in store
 * holds. In that order, so a failure leaves the records that find the
 * library again. */
export async function deleteAccountOnConvex(
  userId: string,
  deps: {
    records?: ConvexAuthRecords;
    eraseLibrary?: typeof eraseLibraryInConvex;
  } = {},
) {
  const records = deps.records ?? convexAuthRecords();
  const user = await records.user(userId);
  if (!user) return false;
  await (deps.eraseLibrary ?? eraseLibraryInConvex)({
    id: user.id,
    athleteId: user.athlete_id,
  });
  await records.deleteUser(userId);
  return true;
}
