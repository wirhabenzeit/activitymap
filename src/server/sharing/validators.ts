import { z } from 'zod';

import { DEFAULT_SHARE_LINK_FIELD_OPTIONS } from '~/lib/sharing/fields';

/**
 * Bounds for a share link's mandatory expiry (issue #132's "mandatory finite
 * expiry with a bounded maximum lifetime" acceptance criterion). The
 * maximum, 30 days, deliberately matches the 30-day full-erasure deadline
 * used elsewhere in this codebase for the same reason
 * (`docs/strava-data-policy.md` §1/§3): it is the longest window this
 * application already commits to keeping any Strava-derived data
 * discoverable at all, so a share link cannot outlive that spirit even
 * though the two mechanisms are otherwise independent. The minimum, one
 * hour, rejects an effectively-instant, `expiresAt` (i.e. one that would
 * already be at or past expiry by the time the athlete finishes creating
 * and copying the link).
 */
export const MIN_SHARE_LINK_TTL_MS = 60 * 60 * 1000;
export const MAX_SHARE_LINK_TTL_DAYS = 30;
export const MAX_SHARE_LINK_TTL_MS = MAX_SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000;

/** An arbitrary but generous bound so a share cannot be used to smuggle an unbounded query. */
export const MAX_SHARE_LINK_ACTIVITIES = 200;

export const shareLinkFieldOptionsSchema = z
  .object({
    heartRate: z.boolean().default(false),
    power: z.boolean().default(false),
    social: z.boolean().default(false),
    preciseLocation: z.boolean().default(false),
  })
  .strict();

/**
 * Validated input for creating a share link. `activityIds` must be a
 * non-empty, explicit, bounded subset - never "all activities" - and
 * `expiresInMs` must fall within the bounds above. Every field-disclosure
 * group defaults to `false`: making one visible is a deliberate opt-in, not
 * an ambient default (see `~/lib/sharing/fields.ts`).
 */
export const createShareLinkInputSchema = z.object({
  activityIds: z
    .array(z.number().int().positive())
    .min(1, 'Select at least one activity to share.')
    .max(
      MAX_SHARE_LINK_ACTIVITIES,
      `A share link can cover at most ${MAX_SHARE_LINK_ACTIVITIES} activities.`,
    )
    .transform((ids) => Array.from(new Set(ids))),
  expiresInMs: z
    .number()
    .int()
    .min(MIN_SHARE_LINK_TTL_MS, 'A share link must last at least one hour.')
    .max(
      MAX_SHARE_LINK_TTL_MS,
      `A share link cannot last more than ${MAX_SHARE_LINK_TTL_DAYS} days.`,
    ),
  fields: shareLinkFieldOptionsSchema.default(DEFAULT_SHARE_LINK_FIELD_OPTIONS),
});

export type CreateShareLinkInput = z.input<typeof createShareLinkInputSchema>;
