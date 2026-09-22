CREATE TABLE "strava_request_budget" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"used" integer NOT NULL,
	"in_flight" integer DEFAULT 0 NOT NULL,
	"ceiling" integer NOT NULL,
	"blocked_until" timestamp
);
--> statement-breakpoint
ALTER TABLE "activity_streams" ADD COLUMN "invalidated_at" timestamp;--> statement-breakpoint
ALTER TABLE "activity_streams" ADD COLUMN "lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "activity_streams" ADD COLUMN "next_retry_at" timestamp;