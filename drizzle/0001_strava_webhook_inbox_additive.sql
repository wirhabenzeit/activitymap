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

-- Backfill: this is a data-preserving "expand" step for consolidating the
-- legacy "webhook" table (Strava's own subscription metadata) into
-- "strava_webhooks" (see issue #124). The legacy table itself is left in
-- place and untouched — dropping it is an intentionally separate, later
-- "contract" step (see docs/swiftui-backend-preparation-plan.md) once no
-- code reads it and this backfill has been verified.
--
-- This is a single upsert keyed on "callback_url" — the column that is
-- actually unique on "strava_webhooks" today — rather than matching rows
-- by subscription id. Matching by subscription id would be wrong if a
-- "strava_webhooks" row's stored subscription_id had ever drifted from
-- the legacy table's current id for the same callback_url (e.g. after a
-- delete+recreate of the Strava subscription): a match-by-id UPDATE would
-- silently miss that row, and a naive fallback INSERT would then try to
-- insert a second row with the same callback_url and fail the existing
-- unique constraint. Keying on callback_url instead means every legacy
-- row updates the one "strava_webhooks" row that actually represents the
-- same subscription, and ON CONFLICT DO UPDATE only touches the columns
-- Strava itself reports — "verify_token" (never held by the legacy table)
-- is preserved on existing rows and only defaulted to a placeholder when
-- inserting a brand new row, which the next checkWebhookStatus/
-- createWebhookSubscription run repairs.
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
ON CONFLICT ("callback_url") DO UPDATE SET
	"subscription_id" = excluded."subscription_id",
	"resource_state" = excluded."resource_state",
	"application_id" = excluded."application_id",
	"verified" = excluded."verified",
	"active" = excluded."active",
	"updated_at" = excluded."updated_at";
--> statement-breakpoint

-- Safety net before the new unique index below: "subscription_id" was
-- never constrained to be unique before this migration, so if any bug
-- ever let two "strava_webhooks" rows end up with the same value, adding
-- the constraint outright would fail this migration. Null out
-- "subscription_id" on all but the most-recently-updated row per
-- duplicate value — the callback_url-keyed backfill above already made
-- that row's data authoritative — rather than leaving the migration
-- unable to proceed. This is a no-op when, as expected, no duplicates
-- exist.
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "subscription_id" ORDER BY "updated_at" DESC, "id"
		) AS rn
	FROM "strava_webhooks"
	WHERE "subscription_id" IS NOT NULL
)
UPDATE "strava_webhooks" sw
SET "subscription_id" = NULL
FROM ranked
WHERE ranked."id" = sw."id" AND ranked.rn > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX "strava_webhook_events_delivery_idx" ON "strava_webhook_events" USING btree ("subscription_id","object_type","object_id","aspect_type","event_time");--> statement-breakpoint
CREATE INDEX "strava_webhook_events_status_idx" ON "strava_webhook_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strava_webhooks_subscription_id_idx" ON "strava_webhooks" USING btree ("subscription_id");
