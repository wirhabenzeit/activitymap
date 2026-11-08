CREATE TABLE "place_matching_pending" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_matching_queue_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"recipe_hash" text NOT NULL,
	"catalogue_snapshot_id" text NOT NULL,
	"catalogue_revision" bigint NOT NULL,
	CONSTRAINT "place_matching_queue_state_singleton_check" CHECK ("place_matching_queue_state"."singleton")
);
--> statement-breakpoint
ALTER TABLE "place_matching_pending" ADD CONSTRAINT "place_matching_pending_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_matching_pending_available_idx" ON "place_matching_pending" USING btree ("available_at","activity_id");
--> statement-breakpoint
CREATE FUNCTION track_pending_place_stream() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM place_matching_pending WHERE activity_id=OLD.activity_id;
    RETURN OLD;
  END IF;
  IF NEW.fetched_at IS NULL OR NEW.invalidated_at IS NOT NULL
    OR NEW.last_attempt_status='invalidated' OR NEW.payload IS NULL THEN
    DELETE FROM place_matching_pending WHERE activity_id=NEW.activity_id;
  ELSIF TG_OP='INSERT' THEN
    INSERT INTO place_matching_pending(activity_id) VALUES(NEW.activity_id)
      ON CONFLICT(activity_id) DO UPDATE SET available_at=clock_timestamp();
  ELSIF (NEW.generation,NEW.revision,NEW.source_version) IS DISTINCT FROM
        (OLD.generation,OLD.revision,OLD.source_version)
    OR OLD.fetched_at IS NULL OR OLD.invalidated_at IS NOT NULL
    OR OLD.last_attempt_status='invalidated' OR OLD.payload IS NULL THEN
    INSERT INTO place_matching_pending(activity_id) VALUES(NEW.activity_id)
      ON CONFLICT(activity_id) DO UPDATE SET available_at=clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_streams_pending_places AFTER INSERT OR UPDATE OR DELETE ON activity_streams
  FOR EACH ROW EXECUTE FUNCTION track_pending_place_stream();
--> statement-breakpoint
CREATE FUNCTION track_pending_place_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A deleted/replaced recipe must be rediscovered, including manual resets.
  IF TG_OP<>'DELETE' THEN
    IF TG_OP='INSERT' OR NEW.recipe_hash=OLD.recipe_hash THEN
      IF NEW.result IS NULL THEN
        INSERT INTO place_matching_pending(activity_id,available_at)
          VALUES(NEW.activity_id,COALESCE(NEW.retry_at,clock_timestamp()))
          ON CONFLICT(activity_id) DO UPDATE SET available_at=EXCLUDED.available_at;
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO place_matching_pending(activity_id)
    SELECT a.id FROM activities a JOIN activity_streams s ON s.activity_id=a.id
    WHERE a.id=OLD.activity_id AND s.fetched_at IS NOT NULL
      AND s.invalidated_at IS NULL AND s.last_attempt_status<>'invalidated' AND s.payload IS NOT NULL
    ON CONFLICT(activity_id) DO UPDATE SET available_at=LEAST(place_matching_pending.available_at,EXCLUDED.available_at);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER place_checks_pending_places AFTER INSERT OR UPDATE OR DELETE ON activity_place_checks
  FOR EACH ROW EXECUTE FUNCTION track_pending_place_check();
--> statement-breakpoint
CREATE FUNCTION track_pending_place_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' AND OLD."providerId"='strava' THEN
    -- A second active grant can keep this owner connected.
    DELETE FROM place_matching_pending p USING activities a,"user" u
      WHERE p.activity_id=a.id AND a.athlete=u.athlete_id AND u.id=OLD."userId"
      AND u.athlete_id::text=OLD."accountId" AND NOT EXISTS (
        SELECT 1 FROM account c WHERE c."userId"=u.id AND c."providerId"='strava'
          AND c."accountId"=u.athlete_id::text AND c.revoked_at IS NULL AND c.scheduled_erasure_at IS NULL
          AND (COALESCE(c."accessToken",c.access_token,'')<>'' OR COALESCE(c."refreshToken",c.refresh_token,'')<>''));
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW."providerId"<>'strava' OR NEW.revoked_at IS NOT NULL OR NEW.scheduled_erasure_at IS NOT NULL
    OR (COALESCE(NEW."accessToken",NEW.access_token,'')='' AND COALESCE(NEW."refreshToken",NEW.refresh_token,'')='') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.revoked_at IS NULL AND OLD.scheduled_erasure_at IS NULL
    AND (COALESCE(OLD."accessToken",OLD.access_token,'')<>'' OR COALESCE(OLD."refreshToken",OLD.refresh_token,'')<>'')
    AND (OLD."userId",OLD."providerId",OLD."accountId") IS NOT DISTINCT FROM
        (NEW."userId",NEW."providerId",NEW."accountId") THEN RETURN NEW; END IF;
  INSERT INTO place_matching_pending(activity_id)
    SELECT a.id FROM "user" u JOIN activities a ON a.athlete=u.athlete_id
      JOIN activity_streams s ON s.activity_id=a.id
    WHERE u.id=NEW."userId" AND u.athlete_id::text=NEW."accountId"
      AND s.fetched_at IS NOT NULL AND s.invalidated_at IS NULL
      AND s.last_attempt_status<>'invalidated' AND s.payload IS NOT NULL
    ON CONFLICT(activity_id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_pending_places AFTER INSERT OR UPDATE OR DELETE ON account
  FOR EACH ROW EXECUTE FUNCTION track_pending_place_account();
