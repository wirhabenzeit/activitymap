UPDATE "activities"
SET "geometry_state" = CASE
	WHEN "is_complete" THEN 'detailed'::"geometry_state"
	ELSE 'summary'::"geometry_state"
END
WHERE "geometry_state" IS NULL;--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "geometry_state" SET NOT NULL;
