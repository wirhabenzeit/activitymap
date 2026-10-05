CREATE TYPE "public"."ingestion_run_outcome" AS ENUM('succeeded', 'partial', 'deferred', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."ingestion_pipeline" AS ENUM('history', 'details');--> statement-breakpoint
CREATE TABLE "activity_detail_attempt" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"attempt_count" integer NOT NULL,
	"last_attempt_at" timestamp NOT NULL,
	"next_attempt_at" timestamp NOT NULL,
	"last_error_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_job_run" (
	"job" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp NOT NULL,
	"last_finished_at" timestamp,
	"last_status" text NOT NULL,
	"last_stop_reason" text,
	"last_completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ingestion_outcome" (
	"user_id" text NOT NULL,
	"pipeline" "ingestion_pipeline" NOT NULL,
	"last_attempt_at" timestamp NOT NULL,
	"last_succeeded_at" timestamp,
	"outcome" "ingestion_run_outcome" NOT NULL,
	"reason" text,
	"retry_at" timestamp,
	CONSTRAINT "ingestion_outcome_user_id_pipeline_pk" PRIMARY KEY("user_id","pipeline")
);
--> statement-breakpoint
ALTER TABLE "activity_detail_attempt" ADD CONSTRAINT "activity_detail_attempt_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_outcome" ADD CONSTRAINT "ingestion_outcome_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_detail_attempt_next_idx" ON "activity_detail_attempt" USING btree ("next_attempt_at");