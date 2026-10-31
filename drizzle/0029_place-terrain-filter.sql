ALTER TABLE "places" ADD COLUMN "dem_elevation_m" real;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "pass_amp_m" real;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "peak_prominence_m" real;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "peak_prominence_capped" boolean;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_terrain_check" CHECK (("places"."peak_prominence_m" IS NULL) = ("places"."peak_prominence_capped" IS NULL)
        AND ("places"."pass_amp_m" IS NULL OR ('pass' = ANY("places"."kinds") AND "places"."pass_amp_m" >= 0 AND "places"."pass_amp_m" < 'Infinity'::real))
        AND ("places"."peak_prominence_m" IS NULL OR ('peak' = ANY("places"."kinds") AND "places"."peak_prominence_m" >= 0 AND "places"."peak_prominence_m" < 'Infinity'::real))
        AND ("places"."dem_elevation_m" IS NULL OR ("places"."dem_elevation_m" > '-Infinity'::real AND "places"."dem_elevation_m" < 'Infinity'::real)));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_hidden_reason_check" CHECK ("places"."hidden_reason" IS NULL OR "places"."hidden_reason" IN ('generic_pass_name', 'low_relief_pass', 'non_mountain_hut'));