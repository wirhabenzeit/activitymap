CREATE TYPE "public"."webhook_event_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'dead_letter');--> statement-breakpoint
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
ALTER TABLE "strava_webhooks" ALTER COLUMN "subscription_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ADD COLUMN "resource_state" integer;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ADD COLUMN "application_id" integer;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "strava_webhooks" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "strava_webhook_events_delivery_idx" ON "strava_webhook_events" USING btree ("subscription_id","object_type","object_id","aspect_type","event_time");--> statement-breakpoint
CREATE INDEX "strava_webhook_events_status_idx" ON "strava_webhook_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strava_webhooks_subscription_id_idx" ON "strava_webhooks" USING btree ("subscription_id");--> statement-breakpoint

-- Backfill: this is a data-preserving "expand" step for consolidating the
-- legacy "webhook" table (Strava's own subscription metadata) into
-- "strava_webhooks" (see issue #124). The legacy table itself is left in
-- place and untouched — dropping it is an intentionally separate, later
-- "contract" step (see docs/swiftui-backend-preparation-plan.md) once no
-- code reads it and the backfill has been verified. This only copies data
-- forward so "strava_webhooks" already reflects Strava's own subscription
-- state, matched by Strava's subscription id.
UPDATE "strava_webhooks" sw
SET
	"resource_state" = w."resource_state",
	"application_id" = w."application_id",
	"verified" = w."verified",
	"active" = w."active",
	"updated_at" = w."updated_at"
FROM "webhook" w
WHERE w."id" = sw."subscription_id";
--> statement-breakpoint

-- Any subscription only known via the legacy "webhook" table (no matching
-- "strava_webhooks" row) is carried over too, using a placeholder verify
-- token since only "strava_webhooks" ever recorded that value; the next
-- checkWebhookStatus/createWebhookSubscription run repairs it.
INSERT INTO "strava_webhooks" (
	"id", "subscription_id", "verify_token", "callback_url",
	"resource_state", "application_id", "verified", "active",
	"created_at", "updated_at"
)
SELECT
	gen_random_uuid()::text, w."id", '', w."callback_url",
	w."resource_state", w."application_id", w."verified", w."active",
	w."created_at", w."updated_at"
FROM "webhook" w
WHERE NOT EXISTS (
	SELECT 1 FROM "strava_webhooks" sw WHERE sw."subscription_id" = w."id"
);