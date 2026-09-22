CREATE TABLE "stream_backfill_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_selected_at" timestamp NOT NULL,
	"select_oldest" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream_backfill_attempt" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"generation" text,
	"attempt_count" integer NOT NULL,
	"last_attempt_at" timestamp NOT NULL,
	"next_attempt_at" timestamp,
	"terminal" boolean DEFAULT false NOT NULL,
	"last_error" jsonb,
	"lease_token" text,
	"lease_expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "stream_backfill_run" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"activity_limit" integer NOT NULL,
	"request_limit" integer NOT NULL,
	"selected" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"paused" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stream_backfill_account" ADD CONSTRAINT "stream_backfill_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_backfill_attempt" ADD CONSTRAINT "stream_backfill_attempt_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;