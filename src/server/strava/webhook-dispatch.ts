import 'server-only';

import { logger } from '~/server/logging/logger';
import {
  type ConvexDispatchClaim,
  type WebhookDispatchRepository,
  createWebhookDispatchRepository,
} from '~/server/repositories/webhook-events';
import {
  type ConvexProviderEvent,
  sendEventToConvex,
} from '~/server/sync/convex-events';

/**
 * Webhook dispatch to Convex (docs/convex-writer-cutover.md, step 6).
 *
 * Strava is acknowledged once an event is in the Postgres inbox, as for
 * every owner. For an owner Convex writes for, the drain leaves the event
 * alone and this passes it on: the inbox row is marked done only after
 * Convex has committed its own record of the event, so at every moment one
 * of the two stores holds it durably. Convex records an event once, so a
 * send that is repeated after a lost response does no harm.
 *
 * Convex refuses events for an owner it does not write for. Those, and
 * events that could not be sent, go back to the inbox and are sent again;
 * they are never dead-lettered.
 */

export const DEFAULT_DISPATCH_BATCH_SIZE = 50;

export type SendToConvex = (
  owner: { userId: string; athleteId: number },
  event: ConvexProviderEvent,
) => Promise<void>;

export type DispatchResult = {
  candidates: number;
  sent: number;
  /** Sent again later: refused by Convex or not delivered. */
  deferred: number;
  /** Claimed by another run first, or no longer for Convex. */
  lostRace: number;
};

/** The event as Convex stores it, or null for one it has no use for. */
export function convexEventFor({
  event,
}: ConvexDispatchClaim): ConvexProviderEvent | null {
  const aspect = event.aspectType;
  if (
    event.objectType !== 'activity' ||
    (aspect !== 'create' && aspect !== 'update' && aspect !== 'delete')
  )
    return null;
  return {
    event: event.id,
    activityId: String(event.objectId),
    aspect,
    eventTime: event.eventTime.getTime(),
  };
}

type DispatchOptions = {
  repository?: WebhookDispatchRepository;
  send?: SendToConvex;
  now?: Date;
};

/** Claim one inbox event for Convex and send it. Returns what happened. */
export async function dispatchEventToConvex(
  id: string,
  {
    repository = createWebhookDispatchRepository(),
    send = sendEventToConvex,
    now = new Date(),
  }: DispatchOptions = {},
): Promise<'sent' | 'deferred' | 'lostRace'> {
  const claim = await repository.claim(id, now);
  if (!claim) return 'lostRace';
  const { event, userId } = claim;
  try {
    const payload = convexEventFor(claim);
    if (!payload) throw new Error('Not an activity event Convex records');
    await send({ userId, athleteId: event.ownerId }, payload);
  } catch (error) {
    await repository.defer(event, error, now);
    logger.warn('[WebhookDispatch] event not delivered to Convex', {
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'deferred';
  }
  if (!(await repository.complete(event, now)))
    // Convex holds the event; the inbox row will be sent once more and
    // recorded there as the same event.
    logger.warn('[WebhookDispatch] lease expired after delivery', {
      eventId: event.id,
    });
  return 'sent';
}

/** One cycle: send the due events of owners Convex writes for. */
export async function dispatchWebhookInboxToConvex({
  batchSize = DEFAULT_DISPATCH_BATCH_SIZE,
  ...options
}: DispatchOptions & { batchSize?: number } = {}): Promise<DispatchResult> {
  const repository = options.repository ?? createWebhookDispatchRepository();
  const now = options.now ?? new Date();
  const candidates = await repository.selectCandidates(batchSize, now);
  const result: DispatchResult = {
    candidates: candidates.length,
    sent: 0,
    deferred: 0,
    lostRace: 0,
  };
  // In order: Convex receives an owner's events as Strava sent them.
  for (const { id } of candidates)
    result[await dispatchEventToConvex(id, { ...options, repository, now })]++;
  if (result.candidates > 0)
    logger.info('[WebhookDispatch] cycle complete', result);
  return result;
}

/** Whether this deployment can reach Convex at all. */
export const convexDispatchConfigured = () =>
  Boolean(process.env.ACTIVITYMAP_CONVEX_SITE);
