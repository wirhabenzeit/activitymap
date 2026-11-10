import { v } from 'convex/values';

import { internalMutation } from './_generated/server';
import { scopeFields } from './ownerScope';
import { idKey, requireWritableOwner } from './owners';

const BATCH_LIMIT = 64;

/**
 * Provider (Strava webhook) events for an owner Convex writes for. The app
 * receives them, keeps its own record, and passes them on here; it marks its
 * record done only once this mutation has committed, so an event is always
 * held durably by one store or the other. Refused unless Convex is the
 * owner's writer, which leaves the event with the app to send again.
 *
 * Nothing consumes these rows yet: Convex ingestion (step 5 of
 * docs/convex-writer-cutover.md) works from them.
 */
export const record = internalMutation({
  args: {
    scope: v.object(scopeFields),
    events: v.array(
      v.object({
        /** The sender's ID for this delivery. */
        event: v.string(),
        activityId: v.string(),
        aspect: v.union(
          v.literal('create'),
          v.literal('update'),
          v.literal('delete'),
        ),
        eventTime: v.number(),
      }),
    ),
  },
  handler: async (ctx, { scope, events }): Promise<number> => {
    if (events.length < 1 || events.length > BATCH_LIMIT)
      throw new Error(`Event batches hold 1-${BATCH_LIMIT} items`);
    const owner = await requireWritableOwner(ctx, scope, 'convex');
    let recorded = 0;
    for (const { event, activityId, aspect, eventTime } of events) {
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(event) ||
        !Number.isSafeInteger(eventTime) ||
        eventTime < 0
      )
        throw new Error('Invalid provider event');
      const activity = idKey(activityId);
      const seen = await ctx.db
        .query('providerEvents')
        .withIndex('by_owner_event', (q) =>
          q.eq('owner', owner._id).eq('event', event),
        )
        .unique();
      if (seen) continue;
      await ctx.db.insert('providerEvents', {
        owner: owner._id,
        event,
        activity,
        aspect,
        eventTime,
        receivedAt: Date.now(),
      });
      recorded++;
    }
    return recorded;
  },
});
