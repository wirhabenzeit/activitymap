import {
  index,
  bigint,
  pgTable,
  text,
  primaryKey,
  timestamp,
  boolean,
  json,
  pgEnum,
  integer,
  real,
} from "drizzle-orm/pg-core";

import type {AdapterAccount} from "next-auth/adapters";

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email"),
  emailVerified: timestamp("emailVerified", {mode: "date"}),
  name: text("name").notNull(),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId").references(() => users.id, {
      onDelete: "cascade",
    }),
    type: text("type").$type<AdapterAccount["type"]>(),
    provider: text("provider").notNull(),
    providerAccountId: integer("providerAccountId")
      .primaryKey()
      .unique(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    userIdIdx: index().on(account.userId),
  })
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, {onDelete: "cascade"}),
  expires: timestamp("expires", {mode: "date"}).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull().unique(),
    token: text("token").notNull(),
    expires: timestamp("expires", {mode: "date"}),
  },
  (vt) => ({
    compoundKey: primaryKey({
      columns: [vt.identifier, vt.token],
    }),
  })
);

export const activityTypeEnum = pgEnum("type", [
  "AlpineSki",
  "BackcountrySki",
  "Canoeing",
  "Crossfit",
  "EBikeRide",
  "Elliptical",
  "Golf",
  "Handcycle",
  "Hike",
  "IceSkate",
  "InlineSkate",
  "Kayaking",
  "Kitesurf",
  "NordicSki",
  "Ride",
  "RockClimbing",
  "RollerSki",
  "Rowing",
  "Run",
  "Sail",
  "Skateboard",
  "Snowboard",
  "Snowshoe",
  "Soccer",
  "StairStepper",
  "StandUpPaddling",
  "Surfing",
  "Swim",
  "Velomobile",
  "VirtualRide",
  "VirtualRun",
  "Walk",
  "WeightTraining",
  "Wheelchair",
  "Windsurf",
  "Workout",
  "Yoga",
]);
export const sportTypeEnum = pgEnum("sport_type", [
  "AlpineSki",
  "BackcountrySki",
  "Badminton",
  "Canoeing",
  "Crossfit",
  "EBikeRide",
  "Elliptical",
  "EMountainBikeRide",
  "Golf",
  "GravelRide",
  "Handcycle",
  "HighIntensityIntervalTraining",
  "Hike",
  "IceSkate",
  "InlineSkate",
  "Kayaking",
  "Kitesurf",
  "MountainBikeRide",
  "NordicSki",
  "Pickleball",
  "Pilates",
  "Racquetball",
  "Ride",
  "RockClimbing",
  "RollerSki",
  "Rowing",
  "Run",
  "Sail",
  "Skateboard",
  "Snowboard",
  "Snowshoe",
  "Soccer",
  "Squash",
  "StairStepper",
  "StandUpPaddling",
  "Surfing",
  "Swim",
  "TableTennis",
  "Tennis",
  "TrailRun",
  "Velomobile",
  "VirtualRide",
  "VirtualRow",
  "VirtualRun",
  "Walk",
  "WeightTraining",
  "Wheelchair",
  "Windsurf",
  "Workout",
  "Yoga",
]);

export type SportType =
  (typeof sportTypeEnum.enumValues)[number];

const valueColumns = {
  distance: real("distance"),
  moving_time: integer("moving_time"),
  elapsed_time: integer("elapsed_time"),
  total_elevation_gain: real("total_elevation_gain"),
  elev_high: real("elev_high"),
  elev_low: real("elev_low"),
  start_date_local_timestamp: bigint(
    "start_date_local_timestamp",
    {mode: "number"}
  ).notNull(),
  achievement_count: integer("achievement_count"),
  kudos_count: integer("kudos_count"),
  comment_count: integer("comment_count"),
  athlete_count: integer("athlete_count"),
  photo_count: integer("photo_count"),
  total_photo_count: integer("total_photo_count"),
  average_speed: real("average_speed"),
  max_speed: real("max_speed"),
  kilojoules: real("kilojoules"),
  max_watts: integer("max_watts"),
  average_watts: real("average_watts"),
  weighted_average_watts: integer("weighted_average_watts"),
};

const booleanColumns = {
  trainer: boolean("trainer"),
  commute: boolean("commute"),
  manual: boolean("manual"),
  private: boolean("private"),
  flagged: boolean("flagged"),
  has_kudoed: boolean("has_kudoed"),
  hide_from_home: boolean("hide_from_home"),
  device_watts: boolean("device_watts"),
  detailed_activity: boolean("detailed_activity"),
};

export const activities = pgTable("activities", {
  ...valueColumns,
  ...booleanColumns,
  id: bigint("id", {mode: "number"}).primaryKey().unique(),
  upload_id: bigint("upload_id", {mode: "number"}),
  external_id: text("external_id"),
  athlete: integer("athlete")
    .references(() => accounts.providerAccountId, {
      onDelete: "cascade",
    })
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: activityTypeEnum("type"),
  sport_type: sportTypeEnum("sport_type").notNull(),
  start_date: timestamp("start_date", {mode: "date"}),
  start_date_local: timestamp("start_date_local", {
    mode: "date",
  }).notNull(),
  timezone: text("timezone"),
  upload_id_str: text("upload_id_str"),
  start_latlng: json("start_latlng").$type<number[]>(),
  end_latlng: json("end_latlng").$type<number[]>(),
  map: json("map").$type<{
    id: string;
    polyline: string;
    summary_polyline: string;
    resourceState: number;
    bbox: [number, number, number, number];
  }>(),
  workout_type: integer("workout_type"),
  gear_id: text("gear_id"),
  device_name: text("device_name"),
});

export const photos = pgTable("photos", {
  unique_id: text("unique_id").primaryKey().unique(),
  athlete_id: integer("athlete_id").references(
    () => accounts.providerAccountId
  ),
  activity_id: bigint("activity_id", {
    mode: "number",
  }).references(() => activities.id),
  activity_name: text("activity_name"),
  post_id: bigint("post_id", {mode: "number"}),
  resource_state: integer("resource_state"),
  caption: text("caption"),
  type: integer("type"),
  source: integer("source"),
  status: integer("status"),
  uploaded_at: timestamp("uploaded_at", {mode: "date"}),
  created_at: timestamp("created_at", {mode: "date"}),
  urls: json("urls"),
  sizes: json("sizes"),
  default_photo: boolean("default_photo"),
  location: json("location").$type<[number, number]>(),
});

export type Activity = typeof activities.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type ValueColumn = keyof typeof valueColumns;
export type BooleanColumn = keyof typeof booleanColumns;
