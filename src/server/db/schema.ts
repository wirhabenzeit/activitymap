import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  bigint,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { sportTypes } from '~/server/strava/types';
import type { SportType } from '~/server/strava/types';
import type { WebhookRequest } from '~/types/strava';

export const sportTypeEnum = pgEnum('sport_type', sportTypes);

export const users = pgTable('user', {
  id: text('id').notNull().primaryKey(),
  name: text('name'),
  email: text('email'),
  emailVerified: boolean('emailVerified').default(false), // Changed to boolean for Better Auth
  image: text('image'),
  athlete_id: bigint('athlete_id', { mode: 'number' }).unique(),
  oldest_activity_reached: boolean('oldest_activity_reached')
    .notNull()
    .default(false),
  // Better Auth additions
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
});

export const accounts = pgTable(
  'account',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()), // Better Auth requires id
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type'), // Legacy NextAuth column; Better Auth never writes this
    provider: text('provider'), // Legacy NextAuth column; Better Auth never writes this
    providerId: text('providerId').notNull(), // Better Auth uses providerId
    providerAccountId: text('providerAccountId'), // Legacy NextAuth column; Better Auth never writes this
    accountId: text('accountId').notNull(), // Better Auth uses accountId
    refresh_token: text('refresh_token'),
    refreshToken: text('refreshToken'), // Better Auth format
    access_token: text('access_token'),
    accessToken: text('accessToken'), // Better Auth format
    expires_at: integer('expires_at'),
    expiresAt: timestamp('expiresAt', { mode: 'date' }), // Better Auth <1.7 format
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { mode: 'date' }), // Better Auth 1.7+ format
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', {
      mode: 'date',
    }), // Better Auth 1.7+ format
    password: text('password'), // Better Auth credential accounts; unused for OAuth
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    idToken: text('idToken'), // Better Auth format
    session_state: text('session_state'),
    // Better Auth additions
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
  },
  (table) => [
    index('userId_idx').on(table.userId),
    index('provider_idx').on(table.provider, table.providerAccountId),
  ],
);

export const sessions = pgTable('session', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()), // Better Auth uses id
  sessionToken: text('sessionToken').unique(), // Keep for backward compat
  token: text('token').notNull().unique(), // Better Auth uses token
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }), // Keep for backward compat
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(), // Better Auth uses expiresAt
  // Better Auth additions
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
});


export const webhooks = pgTable('webhook', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  resource_state: integer('resource_state'),
  application_id: integer('application_id'),
  callback_url: text('callback_url').notNull(),
  created_at: timestamp('created_at', { mode: 'date' }).notNull(),
  updated_at: timestamp('updated_at', { mode: 'date' }).notNull(),
  verified: boolean('verified').notNull().default(false),
  active: boolean('active').notNull().default(true),
});

export const activities = pgTable(
  'activities',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    public_id: bigint('public_id', { mode: 'number' }).notNull().unique(),
    athlete: bigint('athlete', { mode: 'number' })
      .notNull()
      .references(() => users.athlete_id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    distance: doublePrecision('distance'),
    moving_time: integer('moving_time'),
    elapsed_time: integer('elapsed_time'),
    total_elevation_gain: doublePrecision('total_elevation_gain'),
    sport_type: text('sport_type', { enum: sportTypes }).notNull(),
    start_date: timestamp('start_date', { mode: 'date' }).notNull(),
    start_date_local: timestamp('start_date_local', { mode: 'date' }).notNull(),
    timezone: varchar('timezone').notNull(),
    start_latlng: doublePrecision('start_latlng').array(),
    end_latlng: doublePrecision('end_latlng').array(),
    achievement_count: integer('achievement_count'),
    kudos_count: integer('kudos_count'),
    comment_count: integer('comment_count'),
    athlete_count: integer('athlete_count'),
    photo_count: integer('photo_count'),
    total_photo_count: integer('total_photo_count'),
    map_id: varchar('map_id'),
    map_polyline: text('map_polyline'),
    map_summary_polyline: text('map_summary_polyline'),
    map_bbox: doublePrecision('map_bbox').array(),
    trainer: boolean('trainer'),
    commute: boolean('commute'),
    manual: boolean('manual'),
    private: boolean('private'),
    flagged: boolean('flagged'),
    workout_type: integer('workout_type'),
    upload_id: bigint('upload_id', { mode: 'number' }),
    average_speed: doublePrecision('average_speed'),
    max_speed: doublePrecision('max_speed'),
    calories: doublePrecision('calories'),
    has_heartrate: boolean('has_heartrate'),
    average_heartrate: doublePrecision('average_heartrate'),
    max_heartrate: doublePrecision('max_heartrate'),
    heartrate_opt_out: boolean('heartrate_opt_out'),
    display_hide_heartrate_option: boolean('display_hide_heartrate_option'),
    elev_high: doublePrecision('elev_high'),
    elev_low: doublePrecision('elev_low'),
    pr_count: integer('pr_count'),
    has_kudoed: boolean('has_kudoed'),
    hide_from_home: boolean('hide_from_home'),
    gear_id: varchar('gear_id'),
    device_watts: boolean('device_watts'),
    average_watts: doublePrecision('average_watts'),
    max_watts: integer('max_watts'),
    weighted_average_watts: integer('weighted_average_watts'),
    kilojoules: doublePrecision('kilojoules'),
    last_updated: timestamp('last_updated', { mode: 'date' }).defaultNow(),
    is_complete: boolean('is_complete').notNull().default(false),
  },
  (table) => [
    index('activities_athlete_idx').on(table.athlete),
    index('activities_start_date_idx').on(table.start_date),
    index('activities_public_id_idx').on(table.public_id),
  ],
);

export const photos = pgTable(
  'photos',
  {
    unique_id: varchar('unique_id').primaryKey(),
    activity_id: bigint('activity_id', { mode: 'number' })
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    athlete_id: bigint('athlete_id', { mode: 'number' }).notNull(),
    activity_name: text('activity_name'),
    caption: text('caption'),
    type: integer('type').notNull(),
    source: integer('source'),
    urls: jsonb('urls').$type<Record<string, string>>(),
    sizes: jsonb('sizes').$type<Record<string, [number, number]>>(),
    default_photo: boolean('default_photo'),
    location: doublePrecision('location').array(),
    uploaded_at: timestamp('uploaded_at', { mode: 'date' }),
    created_at: timestamp('created_at', { mode: 'date' }),
    post_id: integer('post_id'),
    status: varchar('status'),
    resource_state: integer('resource_state'),
  },
  (table) => [
    index('photos_activity_idx').on(table.activity_id),
    index('photos_athlete_idx').on(table.athlete_id),
  ],
);

export const activitySync = pgTable(
  'activity_sync',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    last_sync: timestamp('last_sync', { mode: 'date' }).defaultNow(),
    sync_in_progress: boolean('sync_in_progress').notNull().default(false),
    last_error: text('last_error'),
  },
  (table) => [index('activity_sync_user_id_idx').on(table.user_id)],
);

export const activityDeletions = pgTable(
  'activity_deletions',
  {
    athlete_id: bigint('athlete_id', { mode: 'number' }).notNull(),
    activity_id: bigint('activity_id', { mode: 'number' }).notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.athlete_id, table.activity_id],
    }),
    index('activity_deletions_athlete_deleted_idx').on(
      table.athlete_id,
      table.deleted_at,
    ),
  ],
);

export const photoDeletions = pgTable(
  'photo_deletions',
  {
    athlete_id: bigint('athlete_id', { mode: 'number' }).notNull(),
    photo_id: varchar('photo_id').notNull(),
    activity_id: bigint('activity_id', { mode: 'number' }),
    deleted_at: timestamp('deleted_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.athlete_id, table.photo_id],
    }),
    index('photo_deletions_athlete_deleted_idx').on(
      table.athlete_id,
      table.deleted_at,
    ),
  ],
);

// export const activitiesRelations = relations(activities, ({ many }) => ({
//   photos: many(photos),
// }));

// export const photosRelations = relations(photos, ({ one }) => ({
//   activity: one(activities, {
//     fields: [photos.activity_id],
//     references: [activities.id],
//   }),
// }));

// export const activitySyncRelations = relations(activitySync, ({ one }) => ({
//   user: one(users, {
//     fields: [activitySync.user_id],
//     references: [users.id],
//   }),
// }));

// export const usersRelations = relations(users, ({ many }) => ({
//   accounts: many(accounts),
//   activities: many(activities, {
//     relationName: 'user_activities',
//   }),
//   activitySyncs: many(activitySync),
// }));

export type User = typeof users.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type ActivitySync = typeof activitySync.$inferSelect;
export type ActivityDeletion = typeof activityDeletions.$inferSelect;
export type PhotoDeletion = typeof photoDeletions.$inferSelect;

// Canonical record of our Strava webhook subscription. The columns below
// (`resourceState`, `applicationId`, `verified`, `active`, and the unique
// index on `subscriptionId`) mirror what the legacy `webhook` table (Strava's
// own subscription metadata, see above) also tracks. This is an additive,
// expand-only step toward consolidating the two (see issue #124): the
// legacy `webhook` table is intentionally left in place and unused code
// paths are removed separately, once nothing depends on it (see
// docs/swiftui-backend-preparation-plan.md's expand/backfill/switch/contract
// rollout rule — dropping it is a later, separate "contract" change).
export const stravaWebhooks = pgTable(
  'strava_webhooks',
  {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    subscriptionId: bigint('subscription_id', { mode: 'number' }),
    verifyToken: text('verify_token').notNull(),
    callbackUrl: text('callback_url').notNull().unique(),
    resourceState: integer('resource_state'),
    applicationId: integer('application_id'),
    verified: boolean('verified').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('strava_webhooks_subscription_id_idx').on(table.subscriptionId),
  ],
);

export type StravaWebhookSubscription = typeof stravaWebhooks.$inferSelect;

export const webhookEventStatusEnum = pgEnum('webhook_event_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'dead_letter',
]);

// Durable inbox for inbound Strava webhook deliveries (see issue #124). A
// unique key on (subscriptionId, objectType, objectId, aspectType,
// eventTime) makes duplicate Strava deliveries create exactly one row.
// This table is purely additive in this migration; the application code
// that reads/writes it lands in a follow-up change once this migration has
// shipped.
export const stravaWebhookEvents = pgTable(
  'strava_webhook_events',
  {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    subscriptionId: bigint('subscription_id', { mode: 'number' }).notNull(),
    objectType: text('object_type').notNull(),
    objectId: bigint('object_id', { mode: 'number' }).notNull(),
    aspectType: text('aspect_type').notNull(),
    ownerId: bigint('owner_id', { mode: 'number' }).notNull(),
    eventTime: timestamp('event_time', { mode: 'date' }).notNull(),
    payload: jsonb('payload').$type<WebhookRequest>().notNull(),
    status: webhookEventStatusEnum('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { mode: 'date' })
      .defaultNow()
      .notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('strava_webhook_events_delivery_idx').on(
      table.subscriptionId,
      table.objectType,
      table.objectId,
      table.aspectType,
      table.eventTime,
    ),
    index('strava_webhook_events_status_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export type StravaWebhookEventRow = typeof stravaWebhookEvents.$inferSelect;

export { sportTypes, type SportType };
