CREATE TABLE "photo_backfill_run" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"selected" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "photo_fetch_attempt" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp NOT NULL,
	"last_error_code" text,
	"lease_token" text,
	"lease_expires_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "photo_fetch_attempt" ADD CONSTRAINT "photo_fetch_attempt_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;