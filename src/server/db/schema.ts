import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  json,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
  bigint,
} from 'drizzle-orm/pg-core';
import type { AdapterAccount } from 'next-auth/adapters';
import { sportTypes } from '~/server/strava/types';
import type { SportType } from '~/server/strava/types';

export const sportTypeEnum = pgEnum('sport_type', sportTypes);

export const users = pgTable('user', {
  id: text('id').notNull().primaryKey(),
  name: text('name'),
  email: text('email'),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccount['type']>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index('userId_idx').on(table.userId),
  ],
);

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').notNull().primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
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
    athlete: bigint('athlete', { mode: 'number' }).notNull(),
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
    map_bbox: doublePrecision('map_bbox').array(4),
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
    activity_id: bigint('activity_id', { mode: 'number' }).notNull(),
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

export const activitiesRelations = relations(activities, ({ many }) => ({
  photos: many(photos),
}));

export const photosRelations = relations(photos, ({ one }) => ({
  activity: one(activities, {
    fields: [photos.activity_id],
    references: [activities.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;

export { sportTypes, type SportType };
