CREATE TYPE "public"."sync_entity_type" AS ENUM('activity', 'photo');--> statement-breakpoint
CREATE TYPE "public"."sync_operation" AS ENUM('upsert', 'delete');--> statement-breakpoint
CREATE TABLE "sync_change" (
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_change_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"athlete_id" bigint NOT NULL,
	"entity_type" "sync_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"operation" "sync_operation" NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_change" ADD CONSTRAINT "sync_change_athlete_id_user_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."user"("athlete_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_change_athlete_sequence_idx" ON "sync_change" USING btree ("athlete_id","sequence");--> statement-breakpoint
CREATE INDEX "sync_change_changed_at_idx" ON "sync_change" USING btree ("changed_at");