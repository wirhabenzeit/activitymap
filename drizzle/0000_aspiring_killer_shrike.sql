-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."sport_type" AS ENUM('AlpineSki', 'BackcountrySki', 'Badminton', 'Canoeing', 'Crossfit', 'EBikeRide', 'Elliptical', 'EMountainBikeRide', 'Golf', 'GravelRide', 'Handcycle', 'HighIntensityIntervalTraining', 'Hike', 'IceSkate', 'InlineSkate', 'Kayaking', 'Kitesurf', 'MountainBikeRide', 'NordicSki', 'Pickleball', 'Pilates', 'Racquetball', 'Ride', 'RockClimbing', 'RollerSki', 'Rowing', 'Run', 'Sail', 'Skateboard', 'Snowboard', 'Snowshoe', 'Soccer', 'Squash', 'StairStepper', 'StandUpPaddling', 'Surfing', 'Swim', 'TableTennis', 'Tennis', 'TrailRun', 'Velomobile', 'VirtualRide', 'VirtualRow', 'VirtualRun', 'Walk', 'WeightTraining', 'Wheelchair', 'Windsurf', 'Workout', 'Yoga');--> statement-breakpoint
CREATE TYPE "public"."type" AS ENUM('AlpineSki', 'BackcountrySki', 'Canoeing', 'Crossfit', 'EBikeRide', 'Elliptical', 'Golf', 'Handcycle', 'Hike', 'IceSkate', 'InlineSkate', 'Kayaking', 'Kitesurf', 'NordicSki', 'Ride', 'RockClimbing', 'RollerSki', 'Rowing', 'Run', 'Sail', 'Skateboard', 'Snowboard', 'Snowshoe', 'Soccer', 'StairStepper', 'StandUpPaddling', 'Surfing', 'Swim', 'Velomobile', 'VirtualRide', 'VirtualRun', 'Walk', 'WeightTraining', 'Wheelchair', 'Windsurf', 'Workout', 'Yoga');--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"emailVerified" timestamp,
	"name" text NOT NULL,
	"image" text
);
--> statement-breakpoint
CREATE TABLE "account" (
	"userId" text,
	"type" text,
	"provider" text NOT NULL,
	"providerAccountId" integer PRIMARY KEY NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"distance" real NOT NULL,
	"moving_time" integer NOT NULL,
	"elapsed_time" integer NOT NULL,
	"total_elevation_gain" real,
	"elev_high" real,
	"elev_low" real,
	"start_date_local_timestamp" bigint NOT NULL,
	"achievement_count" integer,
	"kudos_count" integer,
	"comment_count" integer,
	"athlete_count" integer,
	"photo_count" integer,
	"total_photo_count" integer,
	"average_speed" real,
	"max_speed" real,
	"kilojoules" real,
	"max_watts" integer,
	"average_watts" real,
	"weighted_average_watts" integer,
	"trainer" boolean,
	"commute" boolean,
	"manual" boolean,
	"private" boolean,
	"flagged" boolean,
	"has_kudoed" boolean,
	"hide_from_home" boolean,
	"device_watts" boolean,
	"detailed_activity" boolean,
	"id" bigint PRIMARY KEY NOT NULL,
	"upload_id" bigint,
	"external_id" text,
	"athlete" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "type",
	"sport_type" "sport_type" NOT NULL,
	"start_date" timestamp,
	"start_date_local" timestamp NOT NULL,
	"timezone" text,
	"upload_id_str" text,
	"start_latlng" json,
	"end_latlng" json,
	"map" json,
	"workout_type" integer,
	"gear_id" text,
	"device_name" text,
	"max_heartrate" integer,
	"average_heartrate" integer
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"athlete_id" integer,
	"activity_id" bigint,
	"activity_name" text,
	"post_id" bigint,
	"resource_state" integer,
	"caption" text,
	"type" integer,
	"source" integer,
	"status" integer,
	"uploaded_at" timestamp,
	"created_at" timestamp,
	"urls" json NOT NULL,
	"sizes" json NOT NULL,
	"default_photo" boolean,
	"location" json
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token"),
	CONSTRAINT "verificationToken_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_athlete_account_providerAccountId_fk" FOREIGN KEY ("athlete") REFERENCES "public"."account"("providerAccountId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_athlete_id_account_providerAccountId_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."account"("providerAccountId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_index" ON "account" USING btree ("userId" text_ops);
*/