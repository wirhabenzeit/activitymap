ALTER TABLE "places" ADD COLUMN "pass_highways" text[];--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "pass_amp_m" real;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_pass_filter_check" CHECK (("places"."pass_highways" IS NULL OR 'pass' = ANY("places"."kinds"))
        AND ("places"."pass_amp_m" IS NULL OR ('pass' = ANY("places"."kinds") AND "places"."pass_amp_m" >= 0 AND "places"."pass_amp_m" < 'Infinity'::real)));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_hidden_reason_check" CHECK ("places"."hidden_reason" IS NULL OR "places"."hidden_reason" IN ('generic_pass_name', 'low_relief_pass', 'non_mountain_hut'));