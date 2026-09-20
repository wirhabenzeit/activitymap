import { db as defaultDb } from '~/server/db';
import {
  accounts,
  activities,
  activityDeletions,
  photoDeletions,
  photos,
  stravaWebhookEvents,
  stravaWebhooks,
} from '~/server/db/schema';
import { getAccountInternal } from '~/server/db/internal';
import { fetchStravaActivities } from '~/server/strava/service';
import { activityOwnershipFilter } from '~/server/strava/webhook-filters';
import { eq, sql, and } from 'drizzle-orm';
import { logger } from '~/server/logging/logger';
import type { WebhookRequest } from '~/types/strava';
import { createChangesRepository } from '~/server/repositories/changes';
import { createWebhookEventsRepository } from '~/server/repositories/webhook-events';
import { PermanentWebhookError } from '~/server/strava/webhook-retry';

/** Full erasure of a deauthorized athlete's data must complete within 30 days of revocation (docs/strava-data-policy.md §1/§3). */
const ERASURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const db = defaultDb;
export type DrizzleDb = typeof defaultDb;

/**
 * No 'use server' directive here: this module is only invoked from the
 * webhook Route Handler, and must never become a directly network-callable
 * Server Action (it resolves credentials from a caller-supplied owner_id).
 * See issue #116.
 */

export type StravaWebhookEvent = WebhookRequest;

/**
 * Look up an active subscription matching the delivered `subscription_id`.
 * Deliveries for an unknown or deactivated subscription are rejected before
 * they ever reach the durable inbox (see issue #124).
 */
export async function findActiveSubscription(subscriptionId: number) {
  return db.query.stravaWebhooks.findFirst({
    where: and(
      eq(stravaWebhooks.subscriptionId, subscriptionId),
      eq(stravaWebhooks.active, true),
    ),
  });
}

export type RecordedWebhookEvent = {
  id: string;
  payload: StravaWebhookEvent;
};

/**
 * Durably record an inbound webhook delivery before the route responds.
 * Returns the inbox row id and payload, or `null` when this exact delivery
 * was already recorded (duplicate deliveries must not create a second
 * inbox item).
 */
export async function recordWebhookEvent(
  data: StravaWebhookEvent,
): Promise<RecordedWebhookEvent | null> {
  const eventTime = new Date(data.event_time * 1000);
  const [inserted] = await db
    .insert(stravaWebhookEvents)
    .values({
      subscriptionId: data.subscription_id,
      objectType: data.object_type,
      objectId: data.object_id,
      aspectType: data.aspect_type,
      ownerId: data.owner_id,
      eventTime,
      payload: data,
    })
    .onConflictDoNothing({
      target: [
        stravaWebhookEvents.subscriptionId,
        stravaWebhookEvents.objectType,
        stravaWebhookEvents.objectId,
        stravaWebhookEvents.aspectType,
        stravaWebhookEvents.eventTime,
      ],
    })
    .returning({ id: stravaWebhookEvents.id, payload: stravaWebhookEvents.payload });

  return inserted ?? null;
}

/**
 * Best-effort, single-attempt processing of a just-recorded inbox row, run
 * after the route has already responded to Strava (see `after()` in the
 * route handler). This keeps activities updating close to real time without
 * making the response wait on Strava/DB latency.
 *
 * It claims the row atomically (via `WebhookEventsRepository.claim`, the
 * same claim used by #125's scheduled drain in
 * `~/server/strava/webhook-drain.ts`) rather than unconditionally setting
 * `status = 'processing'`: without that, this best-effort attempt could
 * race a concurrent drain cycle for the same row (the delivery is
 * durable and `nextAttemptAt` defaults to "now", so a drain cycle can see
 * it as due before this call gets to it) and both would call
 * `processWebhookEvent` for the same delivery at once. If the claim finds
 * the row already claimed, already terminal, or not yet due, this is a
 * no-op - the row is either already being handled or will be picked up by
 * the scheduled drain. On failure it applies the same retry/backoff/
 * dead-letter decision the drain uses (`WebhookEventsRepository.fail`),
 * so even this very first attempt contributes correctly to the retry
 * budget instead of leaving the row `failed` forever with no backoff.
 *
 * `payload` is accepted for the route handler's convenience (it already
 * has it from the insert that just happened) but is no longer required to
 * avoid an extra read: `claim`'s `UPDATE ... RETURNING *` already returns
 * the full row, payload included.
 */
export async function processInboxEvent(
  eventId: string,
  payload?: StravaWebhookEvent,
  database: DrizzleDb = defaultDb,
) {
  const repository = createWebhookEventsRepository(database);
  const claimed = await repository.claim(eventId, new Date());
  if (!claimed) return;

  try {
    await processWebhookEvent(payload ?? claimed.payload, database);
    await repository.complete(eventId, new Date());
  } catch (error) {
    logger.error(`[Webhook] Failed to process inbox event ${eventId}:`, error);
    await repository.fail(eventId, claimed.attemptCount, error, new Date());
  }
}

/**
 * Handles a Strava athlete-deauthorization webhook (`object_type:
 * "athlete"`), per docs/strava-data-policy.md §3. Per policy, on receipt
 * the application must, before anything else, stop using the stored
 * token: no refresh attempt, no API call, since Strava has already
 * invalidated it and any such attempt will just fail at Strava's end. This
 * function therefore never calls `resolveAccount`/`fetchActivities` (or
 * any other Strava-calling dependency) at all - it only reads/writes the
 * local `account` row.
 *
 * It is transactional (the token-clearing, `revokedAt`, and
 * `scheduledErasureAt` writes commit or roll back together) and
 * idempotent: a repeated deauthorization delivery for an already-revoked
 * account (e.g. a redelivered webhook, or one retried before the first
 * attempt's DB write was visible) is a safe no-op rather than an error
 * that would keep the row retrying forever, and it never re-extends the
 * erasure deadline on replay.
 *
 * This does not itself execute the 30-day full-erasure deletion (see the
 * PR description's "deferred" section) - it durably records that erasure
 * is due and by when (`accounts.scheduledErasureAt`), and clears the
 * stored tokens so the account is excluded from ordinary token
 * refresh/sync going forward (`getAccountInternal` throws before ever
 * calling Strava once `access_token`/`accessToken` are both null and there
 * is no refresh token to fall back to).
 */
async function handleAthleteDeauthorization(
  data: StravaWebhookEvent,
  database: DrizzleDb,
) {
  const ownerId = data.owner_id;
  await database.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.accountId, ownerId.toString()), eq(accounts.providerId, 'strava')));

    if (!account) {
      logger.info('[Webhook] Deauthorization received for unknown/unlinked account; nothing to revoke', {
        owner_id: ownerId,
      });
      return;
    }

    if (account.revokedAt) {
      // Idempotent no-op: a replayed/redelivered deauthorization for an
      // account already marked revoked must not re-extend the erasure
      // deadline or redo work.
      logger.info('[Webhook] Deauthorization already recorded for this account; ignoring replay', {
        owner_id: ownerId,
      });
      return;
    }

    const now = new Date();
    const scheduledErasureAt = new Date(now.getTime() + ERASURE_WINDOW_MS);

    await tx
      .update(accounts)
      .set({
        access_token: null,
        accessToken: null,
        refresh_token: null,
        refreshToken: null,
        revokedAt: now,
        scheduledErasureAt,
        updatedAt: now,
      })
      .where(eq(accounts.id, account.id));

    logger.info('[Webhook] Recorded athlete deauthorization; tokens cleared and erasure scheduled', {
      owner_id: ownerId,
      scheduledErasureAt,
    });
  });
}

/**
 * Process a Strava webhook event. This is designed to be called from
 * `processInboxEvent` (after durable receipt) or from the drain worker
 * added in #125 (`~/server/strava/webhook-drain.ts`), both of which mark
 * the inbox row `succeeded` only if this function returns normally.
 *
 * It therefore never swallows a failure: every path that does not end in a
 * genuinely completed mutation (an activity upsert, a recorded deletion,
 * or a recorded deauthorization) throws instead of returning, so those
 * rows stay visible as `failed`/`dead_letter` - and therefore actionable -
 * instead of being marked done. See the review on issue #124. Failures
 * that will never resolve on their own (e.g. no local account for this
 * athlete) throw `PermanentWebhookError` so #125's retry classification
 * dead-letters them immediately instead of spending the retry budget.
 */
export type ProcessWebhookEventDeps = {
  resolveAccount?: typeof getAccountInternal;
  fetchActivities?: typeof fetchStravaActivities;
};

export async function processWebhookEvent(
  data: StravaWebhookEvent,
  database: DrizzleDb = defaultDb,
  deps: ProcessWebhookEventDeps = {},
) {
  const { object_type, object_id, owner_id } = data;
  const changesRepo = createChangesRepository(database);
  const resolveAccount = deps.resolveAccount ?? getAccountInternal;
  const fetchActivities = deps.fetchActivities ?? fetchStravaActivities;

  if (object_type === 'athlete') {
    await handleAthleteDeauthorization(data, database);
    return; // Genuinely completed: deauthorization recorded (or a no-op replay).
  }

  // `object_type` (`WebhookRequest['object_type']`, enforced by
  // `webhookEventSchema` before a delivery is ever durably recorded) is
  // exactly `'activity' | 'athlete'`, and the branch above already handles
  // `'athlete'` - so everything from here on is genuinely an activity
  // event; TypeScript narrows `object_type` to `'activity'` accordingly.

  const account = await resolveAccount({ accountId: owner_id.toString() });
  if (!account?.access_token) {
    throw new PermanentWebhookError(
      `No account or valid access token found for athlete ${owner_id}`,
    );
  }

  const { activities: fetchedActivities, photos: fetchedPhotos, notFoundIds } =
    await fetchActivities({
      accessToken: account.access_token,
      activityIds: [object_id],
      includePhotos: true,
      athleteId: owner_id,
      shouldDeletePhotos: true, // Indicate intent to replace photos
      limit: 2, // Ensure we only fetch the specific activity
      // This function performs its own transactional upsert/photo-replace
      // below and records the change feed for it - `persist: false` stops
      // `fetchStravaActivities` from separately (and non-transactionally)
      // writing the same activity/photos first, which would otherwise
      // produce a duplicate, non-atomic write and a duplicate change record
      // for one logical webhook delivery. See issue #122.
      persist: false,
    });

  // Handle case where activity was not found (e.g., deleted). The delete,
  // its tombstone, and its change record must commit together: writing the
  // tombstone unconditionally from the webhook payload's own
  // owner_id/object_id (rather than only when the delete itself returns a
  // row) makes a retried or repeated delivery idempotent - including the
  // case where a prior attempt deleted the activity but failed before
  // recording the tombstone, which would otherwise delete zero rows on
  // retry and skip the tombstone (and the change record) forever.
  if (notFoundIds.includes(object_id)) {
    await database.transaction(async (tx) => {
      // `photos.activity_id` cascades on delete, so this also silently
      // deletes any photos for this activity. Read which ones before the
      // delete so each gets its own change record too - see the identical
      // reasoning in `~/server/repositories/activities.ts`'s
      // `deleteManyForAthlete`.
      const cascadedPhotos = await tx
        .select({ id: photos.unique_id })
        .from(photos)
        .where(eq(photos.activity_id, object_id));

      await tx
        .delete(activities)
        .where(activityOwnershipFilter(object_id, owner_id));
      // Cascading delete should handle photos.
      await tx
        .insert(activityDeletions)
        .values({
          athlete_id: owner_id,
          activity_id: object_id,
          deleted_at: new Date(),
        })
        .onConflictDoUpdate({
          target: [activityDeletions.athlete_id, activityDeletions.activity_id],
          set: {
            deleted_at: sql`excluded.deleted_at`,
          },
        });

      await changesRepo.record(
        [
          {
            athleteId: owner_id,
            entityType: 'activity',
            entityId: object_id,
            operation: 'delete',
          },
          ...cascadedPhotos.map(({ id }) => ({
            athleteId: owner_id,
            entityType: 'photo' as const,
            entityId: id,
            operation: 'delete' as const,
          })),
        ],
        tx,
      );
    });
    return; // Genuinely completed: deletion recorded.
  }

  // Check if we actually got the activity we requested
  const activityToSave = fetchedActivities.find((act) => act.id === object_id);
  if (!activityToSave) {
    throw new Error(
      `Strava did not return activity ${object_id} for athlete ${owner_id}, and it was not reported deleted`,
    );
  }

  // Database Operations within a transaction for atomicity
  await database.transaction(async (tx) => {
    // 1. Upsert the activity
    await tx
      .insert(activities)
      .values(activityToSave) // Already includes athlete ID from transform
      .onConflictDoUpdate({
        target: activities.id,
        set: activityToSave,
      });

    // 2. Handle photos: Delete existing, then insert new ones
    const existingPhotos = await tx
      .select({
        photo_id: photos.unique_id,
        activity_id: photos.activity_id,
      })
      .from(photos)
      .where(eq(photos.activity_id, activityToSave.id));
    await tx.delete(photos).where(eq(photos.activity_id, activityToSave.id));

    if (fetchedPhotos.length > 0) {
      await tx.insert(photos).values(fetchedPhotos);
    }

    const incomingPhotoIds = new Set(
      fetchedPhotos.map((photo) => photo.unique_id),
    );
    const removedPhotos = existingPhotos.filter(
      ({ photo_id }) => !incomingPhotoIds.has(photo_id),
    );

    if (removedPhotos.length > 0) {
      await tx
        .insert(photoDeletions)
        .values(
          removedPhotos.map(({ photo_id, activity_id }) => ({
            athlete_id: owner_id,
            photo_id,
            activity_id,
            deleted_at: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [photoDeletions.athlete_id, photoDeletions.photo_id],
          set: {
            activity_id: sql`excluded.activity_id`,
            deleted_at: sql`excluded.deleted_at`,
          },
        });
    }

    // 3. Record the change feed entries for everything this transaction
    // just did: the activity upsert, a delete for every photo that was
    // replaced away, and an upsert for every photo now current.
    await changesRepo.record(
      [
        {
          athleteId: owner_id,
          entityType: 'activity',
          entityId: activityToSave.id,
          operation: 'upsert',
        },
        ...removedPhotos.map(({ photo_id }) => ({
          athleteId: owner_id,
          entityType: 'photo' as const,
          entityId: photo_id,
          operation: 'delete' as const,
        })),
        ...fetchedPhotos.map((photo) => ({
          athleteId: owner_id,
          entityType: 'photo' as const,
          entityId: photo.unique_id,
          operation: 'upsert' as const,
        })),
      ],
      tx,
    );
  });
  // Genuinely completed: activity/photos transaction committed.
}
