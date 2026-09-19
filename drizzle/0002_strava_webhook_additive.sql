-- Note: alongside the new webhook inbox (issue #124), this migration also
-- catches up schema drift already present on `main` (activity_deletions,
-- photo_deletions, verification, and account column changes from earlier
-- merged work) that had not yet had a migration generated for it. That
-- drift may already be live in a database that was synced with
-- `drizzle-kit push` rather than a migration, so every statement for
-- those pre-existing objects is written to be a no-op when the object
-- already exists, and safe to apply to either kind of database.
CREATE TYPE "public"."webhook_event_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_deletions" (
	"athlete_id" bigint NOT NULL,
	"activity_id" bigint NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "activity_deletions_athlete_id_activity_id_pk" PRIMARY KEY("athlete_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photo_deletions" (
	"athlete_id" bigint NOT NULL,
	"photo_id" varchar NOT NULL,
	"activity_id" bigint,
	"deleted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "photo_deletions_athlete_id_photo_id_pk" PRIMARY KEY("athlete_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE "strava_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" bigint NOT NULL,
	"object_type" text NOT NULL,
	"object_id" bigint NOT NULL,
	"aspect_type" text NOT NULL,
	"owner_id" bigint NOT NULL,
	"event_time" timestamp NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_event_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "provider" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "providerAccountId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ALTER COLUMN "subscription_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt" timestamp;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" timestamp;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "password" text;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ADD COLUMN IF NOT EXISTS "resource_state" integer;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ADD COLUMN IF NOT EXISTS "application_id" integer;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_deletions_athlete_deleted_idx" ON "activity_deletions" USING btree ("athlete_id","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_deletions_athlete_deleted_idx" ON "photo_deletions" USING btree ("athlete_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strava_webhook_events_delivery_idx" ON "strava_webhook_events" USING btree ("subscription_id","object_type","object_id","aspect_type","event_time");--> statement-breakpoint
CREATE INDEX "strava_webhook_events_status_idx" ON "strava_webhook_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "strava_webhooks_subscription_id_idx" ON "strava_webhooks" USING btree ("subscription_id");
