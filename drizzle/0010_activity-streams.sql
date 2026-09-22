CREATE TABLE "activity_streams" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"generation" text NOT NULL,
	"attempt_id" text,
	"requested_types" text[] NOT NULL,
	"payload" jsonb,
	"revision" bigint DEFAULT 0 NOT NULL,
	"source_version" text,
	"fetched_at" timestamp,
	"last_attempt_at" timestamp NOT NULL,
	"last_attempt_status" text NOT NULL,
	"last_error" jsonb
);
--> statement-breakpoint
ALTER TABLE "activity_streams" ADD CONSTRAINT "activity_streams_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;