
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS "pgsodium" WITH SCHEMA "pgsodium";

CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

SET default_tablespace = '';

SET default_table_access_method = "heap";

CREATE TABLE IF NOT EXISTS "public"."strava-activities" (
    "id" bigint NOT NULL,
    "resource_state" bigint,
    "athlete" bigint,
    "name" "text",
    "distance" real,
    "moving_time" bigint,
    "elapsed_time" bigint,
    "total_elevation_gain" real,
    "type" "text",
    "sport_type" "text",
    "workout_type" "text",
    "start_date" timestamp without time zone,
    "start_date_local" timestamp without time zone,
    "timezone" "text",
    "utc_offset" real,
    "location_city" "text",
    "location_state" "text",
    "location_country" "text",
    "achievement_count" bigint,
    "kudos_count" bigint,
    "comment_count" bigint,
    "athlete_count" bigint,
    "photo_count" bigint,
    "trainer" boolean,
    "commute" boolean,
    "manual" boolean,
    "private" boolean,
    "visibility" "text",
    "flagged" boolean,
    "gear_id" "text",
    "start_latlng" real[],
    "end_latlng" real[],
    "average_speed" real,
    "max_speed" real,
    "average_cadence" real,
    "average_temp" bigint,
    "average_watts" real,
    "max_watts" real,
    "weighted_average_watts" real,
    "kilojoules" real,
    "device_watts" boolean,
    "has_heartrate" boolean,
    "average_heartrate" real,
    "max_heartrate" real,
    "heartrate_opt_out" boolean,
    "display_hide_heartrate_option" boolean,
    "elev_high" real,
    "elev_low" real,
    "upload_id" bigint,
    "upload_id_str" "text",
    "external_id" "text",
    "from_accepted_tag" boolean,
    "pr_count" bigint,
    "total_photo_count" bigint,
    "has_kudoed" boolean,
    "suffer_score" real,
    "geometry" "jsonb",
    "geometry_simplified" "jsonb",
    "start_date_local_timestamp" bigint,
    "description" "text",
    "calories" real
);

ALTER TABLE "public"."strava-activities" OWNER TO "postgres";

ALTER TABLE "public"."strava-activities" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."strava-activities_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."strava-athletes" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "access_token" "text",
    "refresh_token" "text",
    "expires_at" bigint
);

ALTER TABLE "public"."strava-athletes" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."strava-athletes-profile" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "first_name" "text",
    "last_name" "text",
    "profile_medium" "text"
);

ALTER TABLE "public"."strava-athletes-profile" OWNER TO "postgres";

ALTER TABLE "public"."strava-athletes-profile" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."strava-athletes-profile_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE "public"."strava-athletes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."strava-athletes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY "public"."strava-activities"
    ADD CONSTRAINT "strava-activities_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."strava-athletes-profile"
    ADD CONSTRAINT "strava-athletes-profile_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."strava-athletes"
    ADD CONSTRAINT "strava-athletes_pkey" PRIMARY KEY ("id");

CREATE POLICY "Enable read access for all users" ON "public"."strava-activities" FOR SELECT TO "anon" USING (true);

CREATE POLICY "Enable read access for all users" ON "public"."strava-athletes-profile" FOR SELECT USING (true);

ALTER TABLE "public"."strava-activities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."strava-athletes" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON TABLE "public"."strava-activities" TO "anon";
GRANT ALL ON TABLE "public"."strava-activities" TO "authenticated";
GRANT ALL ON TABLE "public"."strava-activities" TO "service_role";

GRANT ALL ON SEQUENCE "public"."strava-activities_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."strava-activities_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."strava-activities_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."strava-athletes" TO "anon";
GRANT ALL ON TABLE "public"."strava-athletes" TO "authenticated";
GRANT ALL ON TABLE "public"."strava-athletes" TO "service_role";

GRANT ALL ON TABLE "public"."strava-athletes-profile" TO "anon";
GRANT ALL ON TABLE "public"."strava-athletes-profile" TO "authenticated";
GRANT ALL ON TABLE "public"."strava-athletes-profile" TO "service_role";

GRANT ALL ON SEQUENCE "public"."strava-athletes-profile_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."strava-athletes-profile_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."strava-athletes-profile_id_seq" TO "service_role";

GRANT ALL ON SEQUENCE "public"."strava-athletes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."strava-athletes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."strava-athletes_id_seq" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";

RESET ALL;