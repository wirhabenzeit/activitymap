import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  type ActivityPlacesResponse,
  activityPlacesResponseSchema,
} from '~/contracts/activity-places';
import {
  ActivityPlacesInputChangedError,
  ActivityPlacesUnavailableError,
  matchActivityPlaces,
} from '~/server/application/match-activity-places';
import type { Actor } from '~/server/auth/actor';
import { db } from '~/server/db';
import {
  accounts,
  activities,
  activityStreams,
  placeCatalogues,
  users,
} from '~/server/db/schema';
import { V1_PLACE_REGION } from '~/server/places/catalogue-regions';
import { DEFAULT_MATCHER_POLICY } from '~/server/places/policy';
import { validatePublishedCatalogue } from '~/server/places/published-catalogue';

import { createPlaceDiscoveryRepository } from './places';

const eligible = (actor: Actor, activityId: string) => sql`
  a.id = ${activityId}::bigint AND a.athlete = ${actor.athleteId}
  AND EXISTS (
    SELECT 1 FROM ${users} u JOIN ${accounts} c ON c."userId" = u.id
    WHERE u.id = ${actor.userId} AND u.athlete_id = ${actor.athleteId}
      AND c."providerId" = 'strava' AND c."accountId" = ${String(actor.athleteId)}
      AND c.revoked_at IS NULL AND c.scheduled_erasure_at IS NULL
      AND (COALESCE(c."accessToken", c.access_token, '') <> ''
        OR COALESCE(c."refreshToken", c.refresh_token, '') <> '')
  )`;
const current = sql`s.fetched_at IS NOT NULL AND s.invalidated_at IS NULL
  AND s.last_attempt_status <> 'invalidated' AND s.payload IS NOT NULL
  AND s.source_version = md5(activity_stream_source(a)::text)`;

const tooLarge = sql`CASE WHEN jsonb_typeof(s.payload->'latlng'->'data') = 'array' THEN jsonb_array_length(s.payload->'latlng'->'data') > ${DEFAULT_MATCHER_POLICY.maxSamples} ELSE false END`;

type InputRow = {
  too_large: boolean;
  generation: string | null;
  revision: string;
  source_version: string | null;
  payload: unknown;
};
type FenceRow = {
  generation: string | null;
  revision: string;
  source_version: string | null;
  current: boolean;
};

/** Uses only stored GPS. One read-only snapshot binds input, coverage and places. */
export function createOnDemandPlacesRepository(database: typeof db = db) {
  return {
    match: async (
      actor: Actor,
      activityId: string,
    ): Promise<ActivityPlacesResponse> => {
      const result = await database.transaction(
        async (tx) => {
          await tx.execute(
            sql`SELECT set_config('statement_timeout', '10000', true)`,
          );
          const input = (
            await tx.execute<InputRow>(sql`
          SELECT s.generation::text, COALESCE(s.revision::text, '0') AS revision,
            s.source_version, ${tooLarge} AS too_large, CASE WHEN ${current} AND NOT (${tooLarge}) THEN jsonb_build_object('latlng', s.payload->'latlng', 'time', s.payload->'time', 'distance', s.payload->'distance', 'altitude', s.payload->'altitude') ELSE NULL END AS payload
          FROM ${activities} a LEFT JOIN ${activityStreams} s ON s.activity_id = a.id
          WHERE ${eligible(actor, activityId)}
        `)
          ).rows[0];
          if (!input) throw new ActivityPlacesUnavailableError();
          let catalogue = null;
          if (input.payload !== null) {
            const [row] = await tx
              .select({
                snapshotId: placeCatalogues.snapshotId,
                regionId: placeCatalogues.regionId,
                manifest: placeCatalogues.manifest,
                coverage: placeCatalogues.coverage,
              })
              .from(placeCatalogues)
              .where(
                and(
                  eq(placeCatalogues.active, true),
                  inArray(placeCatalogues.regionId, [
                    V1_PLACE_REGION,
                    'switzerland',
                  ]),
                ),
              )
              .orderBy(
                sql`CASE WHEN ${placeCatalogues.regionId} = ${V1_PLACE_REGION} THEN 0 ELSE 1 END`,
              )
              .limit(1);
            if (row) {
              catalogue = validatePublishedCatalogue(row);
              if (
                catalogue.manifest.catalogue_snapshot_id !== row.snapshotId ||
                (catalogue.manifest.region_id &&
                  catalogue.manifest.region_id !== row.regionId)
              )
                throw new Error('Published catalogue identity disagrees');
            }
          }
          const discovery = createPlaceDiscoveryRepository({
            execute: async <T extends Record<string, unknown>>(
              query: Parameters<typeof tx.execute>[0],
            ) => (await tx.execute<T>(query)).rows as T[],
          });
          const response = await matchActivityPlaces({
            userId: actor.userId,
            activityId,
            input,
            catalogue,
            discover: discovery.discover,
          });
          return { input, response };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      // Recheck outside the snapshot: revocation, deletion or stream replacement
      // during matching must fence the private response, as with stream reads.
      const latest = (
        await database.execute<FenceRow>(sql`
        SELECT s.generation::text, COALESCE(s.revision::text, '0') AS revision,
          s.source_version, COALESCE(${current}, false) AS current
        FROM ${activities} a LEFT JOIN ${activityStreams} s ON s.activity_id = a.id
        WHERE ${eligible(actor, activityId)}
      `)
      ).rows[0];
      if (!latest) throw new ActivityPlacesUnavailableError();
      if (
        latest.generation !== result.input.generation ||
        latest.revision !== result.input.revision ||
        latest.source_version !== result.input.source_version ||
        (result.input.payload !== null && !latest.current)
      )
        throw new ActivityPlacesInputChangedError();
      return activityPlacesResponseSchema.parse(result.response);
    },
  };
}
