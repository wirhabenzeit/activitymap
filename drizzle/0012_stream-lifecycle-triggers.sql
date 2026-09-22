-- Shared source projection: metadata such as names/kudos cannot revalidate
-- sensor samples. Keep fields in sync with STREAM_SOURCE_FIELDS.
CREATE FUNCTION activity_stream_source(a activities) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT jsonb_build_array(
    to_jsonb(a)->'athlete',
    to_jsonb(a)->'map_id',
    to_jsonb(a)->'map_polyline',
    to_jsonb(a)->'map_summary_polyline',
    to_jsonb(a)->'start_date',
    to_jsonb(a)->'start_date_local',
    to_jsonb(a)->'distance',
    to_jsonb(a)->'moving_time',
    to_jsonb(a)->'elapsed_time',
    to_jsonb(a)->'start_latlng',
    to_jsonb(a)->'end_latlng',
    to_jsonb(a)->'total_elevation_gain',
    to_jsonb(a)->'elev_high',
    to_jsonb(a)->'elev_low',
    to_jsonb(a)->'sport_type',
    to_jsonb(a)->'manual',
    to_jsonb(a)->'private',
    to_jsonb(a)->'trainer',
    to_jsonb(a)->'has_heartrate',
    to_jsonb(a)->'heartrate_opt_out',
    to_jsonb(a)->'display_hide_heartrate_option',
    to_jsonb(a)->'average_heartrate',
    to_jsonb(a)->'max_heartrate',
    to_jsonb(a)->'device_watts',
    to_jsonb(a)->'average_watts',
    to_jsonb(a)->'max_watts',
    to_jsonb(a)->'weighted_average_watts',
    to_jsonb(a)->'kilojoules'
  );
$$;
--> statement-breakpoint
CREATE FUNCTION invalidate_activity_streams(activity_key bigint) RETURNS void
LANGUAGE sql AS $$
  UPDATE activity_streams SET generation = gen_random_uuid()::text,
    invalidated_at = clock_timestamp(), attempt_id = NULL,
    lease_expires_at = NULL, next_retry_at = NULL,
    last_attempt_status = 'invalidated', last_error = NULL
  WHERE activity_id = activity_key
    AND (invalidated_at IS NULL OR attempt_id IS NOT NULL);
$$;
--> statement-breakpoint
CREATE FUNCTION invalidate_changed_activity_streams() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF activity_stream_source(OLD) IS DISTINCT FROM activity_stream_source(NEW) THEN
    PERFORM invalidate_activity_streams(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_stream_source_changed AFTER UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION invalidate_changed_activity_streams();
--> statement-breakpoint
CREATE FUNCTION publish_activity_stream_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD IS DISTINCT FROM NEW THEN
    INSERT INTO sync_change (athlete_id, entity_type, entity_id, operation)
      SELECT athlete, 'activity', id::text, 'upsert'
      FROM activities WHERE id = NEW.activity_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_stream_metadata_changed AFTER INSERT OR UPDATE ON activity_streams
  FOR EACH ROW EXECUTE FUNCTION publish_activity_stream_change();
--> statement-breakpoint
-- #182 used an all-column hash. Preserve its payloads, but require revalidation
-- rather than accidentally treating that older version scheme as current.
UPDATE activity_streams SET generation = gen_random_uuid()::text,
  invalidated_at = clock_timestamp(), attempt_id = NULL,
  last_attempt_status = 'invalidated';
