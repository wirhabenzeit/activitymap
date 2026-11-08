CREATE TABLE "activity_place_checks" (
	"activity_id" bigint NOT NULL,
	"recipe_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"stream_generation" text NOT NULL,
	"stream_revision" bigint NOT NULL,
	"source_version" text NOT NULL,
	"catalogue_snapshot_id" text NOT NULL,
	"catalogue_revision" bigint NOT NULL,
	"matcher_version" text NOT NULL,
	"discovery_version" text NOT NULL,
	"parameters_hash" text NOT NULL,
	"result" jsonb,
	"result_revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retry_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "activity_place_checks_activity_id_recipe_hash_pk" PRIMARY KEY("activity_id","recipe_hash"),
	CONSTRAINT "activity_place_checks_recipe_check" CHECK ("activity_place_checks"."recipe_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "activity_place_checks_revision_check" CHECK ("activity_place_checks"."stream_revision" >= 0 AND "activity_place_checks"."catalogue_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "place_catalogue_revision" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "place_catalogue_revision_singleton_check" CHECK ("place_catalogue_revision"."singleton")
);
--> statement-breakpoint
CREATE TABLE "place_matching_lease" (
	"key" text PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_place_checks" ADD CONSTRAINT "activity_place_checks_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_place_checks" ADD CONSTRAINT "activity_place_checks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_place_checks_user_idx" ON "activity_place_checks" USING btree ("user_id");
--> statement-breakpoint
INSERT INTO place_catalogue_revision(singleton, revision) VALUES (true, 0);
--> statement-breakpoint
CREATE FUNCTION advance_place_catalogue_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE place_catalogue_revision SET revision = revision + 1 WHERE singleton;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER places_matching_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON places
  FOR EACH STATEMENT EXECUTE FUNCTION advance_place_catalogue_revision();
--> statement-breakpoint
CREATE TRIGGER catalogue_matching_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON place_catalogues
  FOR EACH STATEMENT EXECUTE FUNCTION advance_place_catalogue_revision();
