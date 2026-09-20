CREATE TYPE "public"."geometry_state" AS ENUM('summary', 'detailed', 'refresh_required');--> statement-breakpoint
CREATE TYPE "public"."photos_state" AS ENUM('current', 'refresh_required');--> statement-breakpoint
CREATE TYPE "public"."summary_reconciliation_phase" AS ENUM('scanning', 'confirming');--> statement-breakpoint
CREATE TABLE "strava_summary_reconciliation" (
	"athlete_id" bigint PRIMARY KEY NOT NULL,
	"scan_started_at" timestamp NOT NULL,
	"scan_before" bigint NOT NULL,
	"next_page" integer DEFAULT 1 NOT NULL,
	"phase" "summary_reconciliation_phase" DEFAULT 'scanning' NOT NULL,
	"candidate_after_id" bigint,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "geometry_state" geometry_state;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "photos_state" "photos_state";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "last_summary_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "last_detailed_fetched_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_summary_reconciled_at" timestamp;--> statement-breakpoint
ALTER TABLE "strava_summary_reconciliation" ADD CONSTRAINT "strava_summary_reconciliation_athlete_id_user_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."user"("athlete_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strava_summary_reconciliation_lease_idx" ON "strava_summary_reconciliation" USING btree ("lease_expires_at","updated_at");