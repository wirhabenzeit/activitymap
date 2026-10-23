import { sql } from 'drizzle-orm';

import type { Actor } from '~/server/auth/actor';
import {
  accounts,
  activities,
  activityPlaces,
  activityStreams,
  places,
  users,
} from '~/server/db/schema';
import { validatePlaceActor } from '~/server/repositories/activity-places-access';

import {
  DEFAULT_MATCHER_POLICY,
  MATCHER_VERSION,
  parametersHash,
} from './policy';

/** Positive memberships only. Absence is not a claim of a completed zero-visit run. */
export function publishedPlacesQuery(actor: Actor) {
  validatePlaceActor(actor);
  return sql`
    SELECT p.id, p.display_name AS name, p.kinds,
      p.elevation_m AS "elevationM", ST_X(p.location::geometry) AS longitude,
      ST_Y(p.location::geometry) AS latitude,
      p.osm_type AS "osmType", p.osm_id::text AS "osmId",
      array_agg(DISTINCT a.id::text ORDER BY a.id::text) AS "activityIds"
    FROM ${activityPlaces} ap
    JOIN ${places} p ON p.id = ap.place_id
    JOIN ${activities} a ON a.id = ap.activity_id
    JOIN ${activityStreams} s ON s.activity_id = a.id
    WHERE a.athlete = ${actor.athleteId}
      AND EXISTS (
        SELECT 1 FROM ${users} u JOIN ${accounts} c ON c."userId" = u.id
        WHERE u.id = ${actor.userId} AND u.athlete_id = ${actor.athleteId}
          AND c."providerId" = 'strava' AND c."accountId" = ${String(actor.athleteId)}
          AND c.revoked_at IS NULL AND c.scheduled_erasure_at IS NULL
          AND (COALESCE(c."accessToken", c.access_token, '') <> ''
            OR COALESCE(c."refreshToken", c.refresh_token, '') <> '')
      )
      AND cardinality(ap.supported_relations) > 0
      AND ap.evidence_version = 2
      AND ap.matcher_version = ${MATCHER_VERSION}
      AND ap.parameters_hash = ${parametersHash(DEFAULT_MATCHER_POLICY)}
      AND ap.catalogue_snapshot_id = p.catalogue_snapshot_id
      AND s.fetched_at IS NOT NULL AND s.invalidated_at IS NULL
      AND s.last_attempt_status <> 'invalidated'
      AND s.payload IS NOT NULL AND 'latlng' = ANY(s.available_types)
      AND ap.input_stream_generation = s.generation
      AND ap.input_stream_revision = s.revision
      AND ap.input_source_version = s.source_version
      AND s.source_version = md5(activity_stream_source(a)::text)
    GROUP BY p.id
    ORDER BY p.display_name, p.id
  `;
}
