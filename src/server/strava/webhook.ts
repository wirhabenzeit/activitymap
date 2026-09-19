import { db } from '~/server/db';
import {
  activities,
  activityDeletions,
  photoDeletions,
  photos,
  stravaWebhookEvents,
  stravaWebhooks,
} from '~/server/db/schema';
import { getAccountInternal } from '~/server/db/internal';
import { fetchStravaActivities } from '~/server/strava/service';
import { eq, sql, and } from 'drizzle-orm';
import { logger } from '~/server/logging/logger';
import type { WebhookRequest } from '~/types/strava';

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
 * making the response wait on Strava/DB latency. It intentionally does not
 * retry: durable retry/backoff, dead-lettering, and reconciliation for rows
 * left `pending` or `failed` here are #125's job.
 *
 * `payload` is optional: the route handler already has it from the insert
 * that just happened and passes it through to skip a redundant read, but
 * a future caller that only has the row id (e.g. #125's reconciliation
 * worker, which discovers rows to retry by querying for `pending`/`failed`
 * status rather than from a fresh insert) can omit it and let this function
 * load the row itself.
 */
export async function processInboxEvent(
  eventId: string,
  payload?: StravaWebhookEvent,
) {
  if (!payload) {
    const event = await db.query.stravaWebhookEvents.findFirst({
      where: eq(stravaWebhookEvents.id, eventId),
    });
    if (!event) return;
    payload = event.payload;
  }

  await db
    .update(stravaWebhookEvents)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(eq(stravaWebhookEvents.id, eventId));

  try {
    await processWebhookEvent(payload);
    await db
      .update(stravaWebhookEvents)
      .set({
        status: 'succeeded',
        attemptCount: sql`${stravaWebhookEvents.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(stravaWebhookEvents.id, eventId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Webhook] Failed to process inbox event ${eventId}:`, error);
    await db
      .update(stravaWebhookEvents)
      .set({
        status: 'failed',
        attemptCount: sql`${stravaWebhookEvents.attemptCount} + 1`,
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(stravaWebhookEvents.id, eventId));
  }
}

/**
 * Process a Strava webhook event. This is designed to be called from
 * `processInboxEvent` (after durable receipt) or from the reconciliation
 * worker added in #125, both of which mark the inbox row `succeeded` only
 * if this function returns normally.
 *
 * It therefore never swallows a failure: every path that does not end in a
 * genuinely completed mutation (an activity upsert or a recorded deletion)
 * throws instead of returning, including unsupported event types like
 * athlete/deauthorization, so those rows stay visible as `failed` — and
 * therefore actionable for #125 — instead of being marked done. See the
 * review on issue #124.
 */
export async function processWebhookEvent(data: StravaWebhookEvent) {
  const { object_type, object_id, owner_id } = data;

  // Athlete (e.g. deauthorization) events are not handled yet; #125 is
  // expected to prioritize them. Throwing keeps the inbox row `failed`
  // rather than falsely `succeeded` so it stays actionable.
  if (object_type !== 'activity') {
    throw new Error(
      `Unsupported webhook object_type "${object_type}" for athlete ${owner_id}; athlete/deauthorization handling is not implemented yet (see issue #125)`,
    );
  }

  const account = await getAccountInternal({ accountId: owner_id.toString() });
  if (!account?.access_token) {
    throw new Error(`No account or valid access token found for athlete ${owner_id}`);
  }

  const { activities: fetchedActivities, photos: fetchedPhotos, notFoundIds } =
    await fetchStravaActivities({
      accessToken: account.access_token,
      activityIds: [object_id],
      includePhotos: true,
      athleteId: owner_id,
      shouldDeletePhotos: true, // Indicate intent to replace photos
      limit: 2, // Ensure we only fetch the specific activity
    });

  // Handle case where activity was not found (e.g., deleted). The delete and
  // its tombstone must commit together: writing the tombstone unconditionally
  // from the webhook payload's own owner_id/object_id (rather than only when
  // the delete itself returns a row) makes a retried or repeated delivery
  // idempotent - including the case where a prior attempt deleted the
  // activity but failed before recording the tombstone, which would
  // otherwise delete zero rows on retry and skip the tombstone forever.
  if (notFoundIds.includes(object_id)) {
    await db.transaction(async (tx) => {
      await tx.delete(activities).where(eq(activities.id, object_id));
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
  await db.transaction(async (tx) => {
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
  });
  // Genuinely completed: activity/photos transaction committed.
}
