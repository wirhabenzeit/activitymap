CREATE TABLE "strava_import_run" (
	"user_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"lease_expires_at" timestamp NOT NULL,
	"retry_at" timestamp NOT NULL,
	"summaries" integer DEFAULT 0 NOT NULL,
	"details" integer DEFAULT 0 NOT NULL,
	"photos" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"history_cursor" jsonb
);
--> statement-breakpoint
ALTER TABLE "strava_import_run" ADD CONSTRAINT "strava_import_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strava_import_run" ADD CONSTRAINT "strava_import_run_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;