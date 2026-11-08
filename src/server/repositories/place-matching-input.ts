import { sql } from 'drizzle-orm';

import type { Actor } from '~/server/auth/actor';
import { accounts, users } from '~/server/db/schema';
import { DEFAULT_MATCHER_POLICY } from '~/server/places/policy';

export const eligiblePlaceActivity = (actor: Actor, activityId: string) => sql`
  a.id = ${activityId}::bigint AND a.athlete = ${actor.athleteId}
  AND EXISTS (
    SELECT 1 FROM ${users} u JOIN ${accounts} c ON c."userId" = u.id
    WHERE u.id = ${actor.userId} AND u.athlete_id = ${actor.athleteId}
      AND c."providerId" = 'strava' AND c."accountId" = ${String(actor.athleteId)}
      AND c.revoked_at IS NULL AND c.scheduled_erasure_at IS NULL
      AND (COALESCE(c."accessToken", c.access_token, '') <> ''
        OR COALESCE(c."refreshToken", c.refresh_token, '') <> '')
  )`;
export const currentPlaceStreams = sql`s.fetched_at IS NOT NULL AND s.invalidated_at IS NULL
  AND s.last_attempt_status <> 'invalidated' AND s.payload IS NOT NULL
  AND s.source_version = md5(activity_stream_source(a)::text)`;

export const placeStreamsTooLarge = sql`CASE WHEN jsonb_typeof(s.payload->'latlng'->'data') = 'array' THEN jsonb_array_length(s.payload->'latlng'->'data') > ${DEFAULT_MATCHER_POLICY.maxSamples} ELSE false END`;
