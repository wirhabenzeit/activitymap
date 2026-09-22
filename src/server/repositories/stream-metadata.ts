import { sql } from 'drizzle-orm';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import { activities, activityStreams } from '~/server/db/schema';

/** Correlated projection: selects only small metadata, never bulk samples. */
export const activityStreamMetadataProjection = sql<StreamMetadata>`coalesce((
  select jsonb_build_object(
    'generation', s.generation, 'revision', s.revision::text,
    'state', case when s.fetched_at is null then 'not_fetched'
      when s.invalidated_at is not null or s.fetched_at + interval '7 days' <= timezone('UTC', now()) then 'stale'
      else 'current' end,
    'fetch_status', s.last_attempt_status,
    'available_types', to_jsonb(s.available_types),
    'fetched_at', to_char(s.fetched_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expires_at', to_char(s.fetched_at + interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) from ${activityStreams} s where s.activity_id = ${activities.id}
), '{"generation":null,"revision":"0","state":"not_fetched","fetch_status":"not_fetched","available_types":[],"fetched_at":null,"expires_at":null}'::jsonb)`;
