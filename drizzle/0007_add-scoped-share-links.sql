CREATE TABLE "share_link_activities" (
	"share_id" text NOT NULL,
	"activity_id" bigint NOT NULL,
	CONSTRAINT "share_link_activities_share_id_activity_id_pk" PRIMARY KEY("share_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"athlete_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"fields" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_link_activities" ADD CONSTRAINT "share_link_activities_share_id_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_activities" ADD CONSTRAINT "share_link_activities_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_athlete_id_user_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."user"("athlete_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_link_activities_activity_idx" ON "share_link_activities" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_hash_idx" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_athlete_idx" ON "share_links" USING btree ("athlete_id","created_at");