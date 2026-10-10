CREATE TABLE "initial_activity_import" (
	"user_id" text PRIMARY KEY NOT NULL,
	"athlete_id" bigint NOT NULL,
	"started_at" timestamp,
	"before" integer,
	"next_page" integer DEFAULT 1 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"history_complete" boolean DEFAULT false NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"retry_at" timestamp,
	"message" text
);
--> statement-breakpoint
ALTER TABLE "initial_activity_import" ADD CONSTRAINT "initial_activity_import_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Existing accounts retain their ordinary background import. Only accounts
-- connected after this rollout automatically enter the onboarding milestone.
INSERT INTO "initial_activity_import" ("user_id", "athlete_id", "completed_at", "history_complete")
SELECT "id", "athlete_id", now(), "oldest_activity_reached"
FROM "user" WHERE "athlete_id" IS NOT NULL;
