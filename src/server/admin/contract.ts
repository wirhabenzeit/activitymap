import { z } from 'zod';

/**
 * What the admin route of the Convex backend answers
 * (`backend/convex/admin.ts`). Strict: a field that is not listed here, such
 * as a name or an email address, is refused rather than passed on.
 */

const count = z.number().int().nonnegative();
const time = z.number();

export const adminOverviewSchema = z.strictObject({
  observedAt: time,
  lastEventAt: time.nullable(),
  catalogue: z
    .strictObject({
      revision: count,
      places: count,
      pending: z.strictObject({ revision: count, startedAt: time }).nullable(),
      tilesLeft: z.strictObject({ count, capped: z.boolean() }),
    })
    .nullable(),
  budget: z.array(
    z.strictObject({
      key: z.string(),
      windowStart: time,
      used: count,
      limit: count,
      blockedUntil: time.nullable(),
    }),
  ),
});

const jobs = z.strictObject({
  activities: count,
  matches: count,
  /** More jobs exist than were counted. */
  capped: z.boolean(),
});

export const adminUserSchema = z.strictObject({
  athleteId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  createdAt: time,
  active: z.boolean(),
  revokedAt: time.nullable(),
  erasureDueAt: time.nullable(),
  counts: z
    .strictObject({
      activities: count,
      recordings: count,
      photos: count,
      toFetch: count,
      rebuilding: z.boolean(),
    })
    .nullable(),
  lastEventAt: time.nullable(),
  sweep: z
    .strictObject({
      phase: z.enum(['idle', 'scanning', 'confirming']),
      dueAt: time,
      running: z.boolean(),
      error: z.string().nullable(),
      listReadAt: time.nullable(),
    })
    .nullable(),
  jobs: z.strictObject({
    queued: jobs,
    failed: jobs,
    blocked: jobs,
    reasons: z.array(
      z.strictObject({
        stage: z.enum(['activities', 'matches']),
        code: z.string(),
        count,
      }),
    ),
    oldestDueAt: time.nullable(),
  }),
});

export const adminUsersPageSchema = z.strictObject({
  page: z.array(adminUserSchema),
  cursor: z.string().nullable(),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;

/** Whether Strava delivers events to this deployment. */
export type PushSubscription =
  | 'registered'
  /** Strava has none, or one for another URL. */
  | 'missing'
  /** Strava did not answer. */
  | 'unknown'
  /** This deployment does not manage one (preview, local). */
  | 'not_managed';

export type AdminSnapshot = AdminOverview & {
  users: AdminUser[];
  subscription: PushSubscription;
};
