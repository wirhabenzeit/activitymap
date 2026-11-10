ALTER TABLE "user" ADD COLUMN "writer" text DEFAULT 'postgres' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "writer_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_writer_check" CHECK ("user"."writer" IN ('postgres', 'handoff', 'convex'));--> statement-breakpoint
-- The writer fence (src/server/db/writer-fence.ts). An owner's library rows
-- may be written only while Postgres is that owner's writer. The check runs
-- in the same transaction as each write, so it also stops work that was
-- selected before a handoff. A transaction that must write anyway (the
-- replica writes of the reverse mirror, account erasure) sets
-- activitymap.writer_fence to 'bypass' for itself.
CREATE FUNCTION writer_fence_check(owner_athlete bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  current_writer text;
BEGIN
  IF owner_athlete IS NULL
    OR current_setting('activitymap.writer_fence', true) = 'bypass' THEN
    RETURN;
  END IF;
  -- The share lock makes a handoff (an update of this row) wait until every
  -- transaction that has written for the owner has finished, and makes a
  -- transaction whose snapshot predates the handoff fail here.
  SELECT writer INTO current_writer FROM "user"
    WHERE athlete_id = owner_athlete FOR SHARE;
  IF current_writer IS NOT NULL AND current_writer <> 'postgres' THEN
    RAISE EXCEPTION 'Postgres is not the writer for this owner (%)', current_writer
      USING ERRCODE = 'AMW01';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION fence_activities() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM writer_fence_check(OLD.athlete);
    RETURN OLD;
  END IF;
  PERFORM writer_fence_check(NEW.athlete);
  -- A row may not be moved away from a fenced owner either.
  IF TG_OP = 'UPDATE' AND OLD.athlete IS DISTINCT FROM NEW.athlete THEN
    PERFORM writer_fence_check(OLD.athlete);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION fence_photos() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM writer_fence_check(OLD.athlete_id);
    RETURN OLD;
  END IF;
  PERFORM writer_fence_check(NEW.athlete_id);
  IF TG_OP = 'UPDATE' AND OLD.athlete_id IS DISTINCT FROM NEW.athlete_id THEN
    PERFORM writer_fence_check(OLD.athlete_id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION fence_activity_rows() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target record;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD; ELSE target := NEW; END IF;
  -- Rows keyed by activity. When the activity itself is being deleted the
  -- cascade finds no parent here; the fence on activities already decided.
  PERFORM writer_fence_check(
    (SELECT athlete FROM activities WHERE id = target.activity_id)
  );
  RETURN target;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activities_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON activities
  FOR EACH ROW EXECUTE FUNCTION fence_activities();
--> statement-breakpoint
CREATE TRIGGER photos_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON photos
  FOR EACH ROW EXECUTE FUNCTION fence_photos();
--> statement-breakpoint
CREATE TRIGGER activity_streams_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON activity_streams
  FOR EACH ROW EXECUTE FUNCTION fence_activity_rows();
--> statement-breakpoint
CREATE TRIGGER activity_places_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON activity_places
  FOR EACH ROW EXECUTE FUNCTION fence_activity_rows();
--> statement-breakpoint
CREATE TRIGGER activity_place_checks_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON activity_place_checks
  FOR EACH ROW EXECUTE FUNCTION fence_activity_rows();
