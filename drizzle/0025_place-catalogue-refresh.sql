CREATE TABLE "place_catalogues" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"region_id" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"manifest" jsonb NOT NULL,
	"coverage" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_catalogues_region_check" CHECK ("place_catalogues"."region_id" ~ '^[a-z][a-z0-9-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "catalogue_region" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "place_catalogues_active_region_idx" ON "place_catalogues" USING btree ("region_id") WHERE "place_catalogues"."active";