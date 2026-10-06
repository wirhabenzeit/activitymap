CREATE TABLE "scheduled_job_log" (
	"id" text PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" text NOT NULL,
	"stop_reason" text,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "scheduled_job_log_started_at_idx" ON "scheduled_job_log" USING btree ("started_at");