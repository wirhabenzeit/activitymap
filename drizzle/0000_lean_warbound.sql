-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."sport_type" AS ENUM('AlpineSki', 'BackcountrySki', 'Badminton', 'Canoeing', 'Crossfit', 'EBikeRide', 'EMountainBikeRide', 'Elliptical', 'Golf', 'GravelRide', 'Handcycle', 'HighIntensityIntervalTraining', 'Hike', 'IceSkate', 'InlineSkate', 'Kayaking', 'Kitesurf', 'MountainBikeRide', 'NordicSki', 'Pickleball', 'Pilates', 'Racquetball', 'Ride', 'RockClimbing', 'RollerSki', 'Rowing', 'Run', 'Sail', 'Skateboard', 'Snowboard', 'Snowshoe', 'Soccer', 'Squash', 'StairStepper', 'StandUpPaddling', 'Surfing', 'Swim', 'TableTennis', 'Tennis', 'TrailRun', 'Velomobile', 'VirtualRide', 'VirtualRow', 'VirtualRun', 'Walk', 'WeightTraining', 'Wheelchair', 'Windsurf', 'Workout', 'Yoga');--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" bigint PRIMARY KEY NOT NULL,
	"resource_state" integer,
	"application_id" integer,
	"callback_url" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	"athlete_id" bigint,
	"oldest_activity_reached" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_athlete_id_unique" UNIQUE("athlete_id")
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" bigint PRIMARY KEY NOT NULL,
	"public_id" bigint NOT NULL,
	"athlete" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"distance" double precision,
	"moving_time" integer,
	"elapsed_time" integer,
	"total_elevation_gain" double precision,
	"sport_type" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"start_date_local" timestamp NOT NULL,
	"timezone" varchar NOT NULL,
	"start_latlng" double precision[],
	"end_latlng" double precision[],
	"achievement_count" integer,
	"kudos_count" integer,
	"comment_count" integer,
	"athlete_count" integer,
	"photo_count" integer,
	"total_photo_count" integer,
	"map_id" varchar,
	"map_polyline" text,
	"map_summary_polyline" text,
	"map_bbox" double precision[],
	"trainer" boolean,
	"commute" boolean,
	"manual" boolean,
	"private" boolean,
	"flagged" boolean,
	"workout_type" integer,
	"upload_id" bigint,
	"average_speed" double precision,
	"max_speed" double precision,
	"calories" double precision,
	"has_heartrate" boolean,
	"average_heartrate" double precision,
	"max_heartrate" double precision,
	"heartrate_opt_out" boolean,
	"display_hide_heartrate_option" boolean,
	"elev_high" double precision,
	"elev_low" double precision,
	"pr_count" integer,
	"has_kudoed" boolean,
	"hide_from_home" boolean,
	"gear_id" varchar,
	"device_watts" boolean,
	"average_watts" double precision,
	"max_watts" integer,
	"weighted_average_watts" integer,
	"kilojoules" double precision,
	"last_updated" timestamp DEFAULT now(),
	"is_complete" boolean DEFAULT false NOT NULL,
	CONSTRAINT "activities_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "activity_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"last_sync" timestamp DEFAULT now(),
	"sync_in_progress" boolean DEFAULT false NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"unique_id" varchar PRIMARY KEY NOT NULL,
	"activity_id" bigint NOT NULL,
	"athlete_id" bigint NOT NULL,
	"activity_name" text,
	"caption" text,
	"type" integer NOT NULL,
	"source" integer,
	"urls" jsonb,
	"sizes" jsonb,
	"default_photo" boolean,
	"location" double precision[],
	"uploaded_at" timestamp,
	"created_at" timestamp,
	"post_id" integer,
	"status" varchar,
	"resource_state" integer
);
--> statement-breakpoint
CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_athlete_user_athlete_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."user"("athlete_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sync" ADD CONSTRAINT "activity_sync_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_athlete_idx" ON "activities" USING btree ("athlete" int8_ops);--> statement-breakpoint
CREATE INDEX "activities_public_id_idx" ON "activities" USING btree ("public_id" int8_ops);--> statement-breakpoint
CREATE INDEX "activities_start_date_idx" ON "activities" USING btree ("start_date" timestamp_ops);--> statement-breakpoint
CREATE INDEX "activity_sync_user_id_idx" ON "activity_sync" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "photos_activity_idx" ON "photos" USING btree ("activity_id" int8_ops);--> statement-breakpoint
CREATE INDEX "photos_athlete_idx" ON "photos" USING btree ("athlete_id" int8_ops);--> statement-breakpoint
CREATE INDEX "userId_idx" ON "account" USING btree ("userId" text_ops);
*/