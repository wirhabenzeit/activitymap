ALTER TABLE "activity_streams" ADD COLUMN "available_types" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
-- Backfill small metadata once; ordinary activity projections must never
-- detoast raw samples just to discover which sensors exist.
UPDATE activity_streams s SET available_types = ARRAY(
  SELECT k FROM jsonb_object_keys(s.payload) k
  ORDER BY array_position(ARRAY['time','distance','latlng','altitude','watts','heartrate'], k)
);
