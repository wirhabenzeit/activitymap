-- Backfill "strava_webhooks" from the legacy "webhook" table (Strava's own
-- subscription metadata) before dropping it, matched by Strava's
-- subscription id. See issue #124.
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
--> statement-breakpoint

DROP TABLE "webhook" CASCADE;
