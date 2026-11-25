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
      /** The last few, the newest first. None from a backend before them. */
      publications: z
        .array(
          z.strictObject({
            revision: count,
            /** Null while it is being applied. */
            completedAt: time.nullable(),
            source: z
              .strictObject({ dataAsOf: time, regions: count })
              .nullable(),
            /** Changed map tiles, and those the re-match walk finished. */
            tiles: count,
            tilesDone: count,
            walkedAt: time.nullable(),
          }),
        )
        .default([]),
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
  /** Scheduled jobs and their last success. None from a backend before
   * they were recorded. */
  jobs: z
    .array(
      z.strictObject({
        job: z.string().regex(/^[a-z-]{1,64}$/),
        intervalMs: count,
        /** Null until the job has succeeded once since this was recorded. */
        succeededAt: time.nullable(),
      }),
    )
    .default([]),
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
  /** Whether a sign-in record belongs to the library. A backend from before
   * this field does not say; it deploys separately from the app. */
  hasAccount: z.boolean().default(true),
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
  /** Null until counted, and from a backend before these counts. */
  matches: z
    .strictObject({
      matched: count,
      /** Matches of the catalogue revision that replaced an older one. */
      rematched: z.strictObject({ revision: count, count }),
      rebuilding: z.boolean(),
    })
    .nullable()
    .default(null),
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
  /** Library records that belong to a user. */
  users: AdminUser[];
  /** How many do not: see `withoutLeftovers`. */
  leftovers: number;
  subscription: PushSubscription;
};
