import { and, eq } from 'drizzle-orm';
import { activities } from '~/server/db/schema';

/**
 * Scope any mutation of the `activities` table to the row genuinely owned by
 * the delivered `owner_id`, never `object_id` alone. A Strava webhook
 * subscription is per-application, not per-athlete or cryptographically
 * signed per delivery (see the review on issue #124); a delivery matching a
 * known active subscription only proves it names one of our own
 * subscriptions, not that `owner_id`/`object_id` are truthfully paired.
 * Without this filter, a delivery claiming a foreign `object_id` under any
 * `owner_id` would delete another athlete's activity row.
 *
 * Kept in its own leaf module (no `~/server/db/internal` or Strava-client
 * imports) so it stays importable from a plain `node:test` run without
 * pulling in `server-only`.
 */
export function activityOwnershipFilter(objectId: number, ownerId: number) {
  return and(eq(activities.id, objectId), eq(activities.athlete, ownerId));
}
