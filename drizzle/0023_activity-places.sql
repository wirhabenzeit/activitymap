CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "activity_places" (
	"activity_id" bigint NOT NULL,
	"place_id" uuid NOT NULL,
	"supported_relations" text[] NOT NULL,
	"encounters" jsonb NOT NULL,
	"evidence_version" integer NOT NULL,
	"input_stream_generation" text NOT NULL,
	"input_stream_revision" bigint NOT NULL,
	"input_source_version" text NOT NULL,
	"catalogue_snapshot_id" text NOT NULL,
	"matcher_version" text NOT NULL,
	"parameters_hash" text NOT NULL,
	"run_id" uuid NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_places_activity_id_place_id_pk" PRIMARY KEY("activity_id","place_id"),
	CONSTRAINT "activity_places_supported_relations_check" CHECK ("activity_places"."supported_relations" <@ ARRAY['reached_peak', 'reached_saddle', 'crossed_pass', 'arrived_at_hut']::text[]
    AND cardinality("activity_places"."supported_relations") = (CASE WHEN 'reached_peak' = ANY("activity_places"."supported_relations") THEN 1 ELSE 0 END + CASE WHEN 'reached_saddle' = ANY("activity_places"."supported_relations") THEN 1 ELSE 0 END + CASE WHEN 'crossed_pass' = ANY("activity_places"."supported_relations") THEN 1 ELSE 0 END + CASE WHEN 'arrived_at_hut' = ANY("activity_places"."supported_relations") THEN 1 ELSE 0 END)
    AND (cardinality("activity_places"."supported_relations") = 0 OR (array_ndims("activity_places"."supported_relations") = 1 AND array_lower("activity_places"."supported_relations", 1) = 1))
    ),
	CONSTRAINT "activity_places_encounters_check" CHECK (CASE WHEN jsonb_typeof("activity_places"."encounters") = 'array'
        THEN jsonb_array_length("activity_places"."encounters") > 0 ELSE false END),
	CONSTRAINT "activity_places_evidence_version_check" CHECK ("activity_places"."evidence_version" > 0),
	CONSTRAINT "activity_places_stream_generation_check" CHECK (length(btrim("activity_places"."input_stream_generation")) > 0),
	CONSTRAINT "activity_places_stream_revision_check" CHECK ("activity_places"."input_stream_revision" >= 0),
	CONSTRAINT "activity_places_source_version_check" CHECK (length(btrim("activity_places"."input_source_version")) > 0),
	CONSTRAINT "activity_places_catalogue_snapshot_check" CHECK (length(btrim("activity_places"."catalogue_snapshot_id")) > 0),
	CONSTRAINT "activity_places_matcher_version_check" CHECK (length(btrim("activity_places"."matcher_version")) > 0),
	CONSTRAINT "activity_places_parameters_hash_check" CHECK ("activity_places"."parameters_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_type" text NOT NULL,
	"osm_id" bigint NOT NULL,
	"kinds" text[] NOT NULL,
	"subtypes" text[] NOT NULL,
	"display_name" text NOT NULL,
	"names" jsonb NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"elevation_m" real,
	"tags" jsonb NOT NULL,
	"osm_version" integer NOT NULL,
	"osm_updated_at" timestamp with time zone NOT NULL,
	"point_derivation" text NOT NULL,
	"normalization_version" text NOT NULL,
	"catalogue_snapshot_id" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_osm_type_check" CHECK ("places"."osm_type" IN ('node', 'way', 'relation')),
	CONSTRAINT "places_osm_id_check" CHECK ("places"."osm_id" > 0),
	CONSTRAINT "places_kinds_check" CHECK ("places"."kinds" <@ ARRAY['peak', 'pass', 'hut']::text[]
    AND cardinality("places"."kinds") = (CASE WHEN 'peak' = ANY("places"."kinds") THEN 1 ELSE 0 END + CASE WHEN 'pass' = ANY("places"."kinds") THEN 1 ELSE 0 END + CASE WHEN 'hut' = ANY("places"."kinds") THEN 1 ELSE 0 END)
    AND (cardinality("places"."kinds") = 0 OR (array_ndims("places"."kinds") = 1 AND array_lower("places"."kinds", 1) = 1))
    AND cardinality("places"."kinds") > 0),
	CONSTRAINT "places_subtypes_check" CHECK ("places"."subtypes" <@ ARRAY['peak', 'natural_saddle', 'road_trail_pass', 'alpine_hut', 'wilderness_hut']::text[]
    AND cardinality("places"."subtypes") = (CASE WHEN 'peak' = ANY("places"."subtypes") THEN 1 ELSE 0 END + CASE WHEN 'natural_saddle' = ANY("places"."subtypes") THEN 1 ELSE 0 END + CASE WHEN 'road_trail_pass' = ANY("places"."subtypes") THEN 1 ELSE 0 END + CASE WHEN 'alpine_hut' = ANY("places"."subtypes") THEN 1 ELSE 0 END + CASE WHEN 'wilderness_hut' = ANY("places"."subtypes") THEN 1 ELSE 0 END)
    AND (cardinality("places"."subtypes") = 0 OR (array_ndims("places"."subtypes") = 1 AND array_lower("places"."subtypes", 1) = 1))
    AND cardinality("places"."subtypes") > 0),
	CONSTRAINT "places_kind_subtype_check" CHECK (('peak' = ANY("places"."kinds")) = ('peak' = ANY("places"."subtypes"))
        AND ('pass' = ANY("places"."kinds")) = ("places"."subtypes" && ARRAY['natural_saddle', 'road_trail_pass']::text[])
        AND ('hut' = ANY("places"."kinds")) = ("places"."subtypes" && ARRAY['alpine_hut', 'wilderness_hut']::text[])),
	CONSTRAINT "places_display_name_check" CHECK (length(btrim("places"."display_name")) > 0),
	CONSTRAINT "places_names_check" CHECK (jsonb_typeof("places"."names") = 'object' AND NOT jsonb_path_exists("places"."names", '$.* ? (@.type() != "string")')),
	CONSTRAINT "places_tags_check" CHECK (jsonb_typeof("places"."tags") = 'object' AND NOT jsonb_path_exists("places"."tags", '$.* ? (@.type() != "string")')),
	CONSTRAINT "places_location_check" CHECK (NOT ST_IsEmpty("places"."location"::geometry)
        AND ST_IsValid("places"."location"::geometry)
        AND ST_X("places"."location"::geometry) BETWEEN -180 AND 180
        AND ST_Y("places"."location"::geometry) BETWEEN -90 AND 90),
	CONSTRAINT "places_elevation_check" CHECK ("places"."elevation_m" > '-Infinity'::real AND "places"."elevation_m" < 'Infinity'::real),
	CONSTRAINT "places_osm_version_check" CHECK ("places"."osm_version" > 0),
	CONSTRAINT "places_point_derivation_check" CHECK (("places"."osm_type" = 'node' AND "places"."point_derivation" = 'osm_node')
        OR ("places"."osm_type" IN ('way', 'relation')
          AND "places"."point_derivation" = 'validated_polygon_interior'
          AND 'hut' = ANY("places"."kinds"))),
	CONSTRAINT "places_normalization_version_check" CHECK (length(btrim("places"."normalization_version")) > 0),
	CONSTRAINT "places_catalogue_snapshot_check" CHECK (length(btrim("places"."catalogue_snapshot_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "activity_places" ADD CONSTRAINT "activity_places_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_places" ADD CONSTRAINT "activity_places_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_places_place_activity_idx" ON "activity_places" USING btree ("place_id","activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "places_osm_identity_idx" ON "places" USING btree ("osm_type","osm_id");--> statement-breakpoint
CREATE INDEX "places_location_idx" ON "places" USING gist ("location");
