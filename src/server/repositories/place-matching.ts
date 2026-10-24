import 'server-only';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import {
  type ActivityPlacesResponse,
  activityPlacesResponseSchema,
} from '~/contracts/activity-places';
import {
  type ActivityPlaceInput,
  ActivityPlacesInputChangedError,
  ActivityPlacesUnavailableError,
} from '~/server/application/match-activity-places';
import type { Actor } from '~/server/auth/actor';
import { db } from '~/server/db';
import type { ActivityLocationHint } from '~/server/places/activity-clusters';
import { canonicalJson } from '~/server/places/catalogue-artifact';
import { V1_PLACE_REGION } from '~/server/places/catalogue-regions';
import {
  MATCHING_RECIPE,
  MATCHING_RECIPE_HASH,
  type MatchingCatalogue,
  matchingVersion,
} from '~/server/places/matching-version';

import { createChangesRepository } from './changes';
import {
  currentPlaceStreams as current,
  eligiblePlaceActivity as eligible,
  placeStreamsTooLarge as tooLarge,
} from './place-matching-input';

const KEY = 'activity-place-matching';
const preferredCatalogue = sql`(SELECT snapshot_id FROM place_catalogues WHERE active AND region_id IN (${V1_PLACE_REGION}, 'switzerland') ORDER BY CASE WHEN region_id=${V1_PLACE_REGION} THEN 0 ELSE 1 END LIMIT 1)`;
const connected = sql`EXISTS (SELECT 1 FROM account c WHERE c."userId"=u.id AND c."providerId"='strava' AND c."accountId"=u.athlete_id::text AND c.revoked_at IS NULL AND c.scheduled_erasure_at IS NULL AND (COALESCE(c."accessToken",c.access_token,'')<>'' OR COALESCE(c."refreshToken",c.refresh_token,'')<>''))`;
export type MatchingCandidate = {
  activityId: string;
  userId: string;
  athleteId: number;
  generation: string;
  revision: string;
  sourceVersion: string;
  locationHint?: ActivityLocationHint;
};
type StoredCandidate = {
  activity_id: string;
  user_id: string;
  athlete_id: number;
  generation: string;
  revision: string;
  source_version: string;
  map_bbox: number[] | null;
  start_latlng: number[] | null;
};
const sameInput = (catalogue: MatchingCatalogue) =>
  sql`c.user_id=u.id AND c.stream_generation=s.generation AND c.stream_revision=s.revision AND c.source_version=s.source_version AND c.catalogue_snapshot_id=${catalogue.snapshotId} AND c.catalogue_revision=${catalogue.revision}::bigint`;

/** One leased worker; no job queue to populate or invalidate. Eligibility is a
 * comparison with current input/version tuples, so a crash cannot lose work. */
export function createPlaceMatchingRepository(database: typeof db = db) {
  const catalogue = async (): Promise<MatchingCatalogue> => {
    const row = (
      await database.execute<{ snapshot_id: string | null; revision: string }>(
        sql`SELECT ${preferredCatalogue} AS snapshot_id, revision::text FROM place_catalogue_revision WHERE singleton`,
      )
    ).rows[0];
    if (!row) throw new Error('Missing place catalogue revision');
    return { snapshotId: row.snapshot_id, revision: row.revision };
  };
  type ResultRow = {
    activity_id: string;
    generation: string | null;
    revision: string;
    source_version: string | null;
    current: boolean;
    snapshot_id: string | null;
    catalogue_revision: string;
    result: unknown;
    result_revision: string | null;
  };
  const readRows = async (
    actor: Actor,
    activityIds: string[],
    execute: typeof database.execute = database.execute.bind(database),
  ): Promise<ResultRow[]> => {
    if (!activityIds.length) return [];
    return (
      await execute<ResultRow>(sql`
    SELECT a.id::text AS activity_id, s.generation, COALESCE(s.revision::text,'0') AS revision, s.source_version,
      COALESCE(${current},false) AS current, ${preferredCatalogue} AS snapshot_id,
      r.revision::text AS catalogue_revision,
      CASE WHEN c.user_id=${actor.userId} AND ${current} AND c.stream_generation=s.generation
        AND c.stream_revision=s.revision AND c.source_version=s.source_version
        AND c.catalogue_snapshot_id=${preferredCatalogue} AND c.catalogue_revision=r.revision
        THEN c.result END AS result, c.result_revision::text
    FROM activities a LEFT JOIN activity_streams s ON s.activity_id=a.id
    CROSS JOIN place_catalogue_revision r
    LEFT JOIN activity_place_checks c ON c.activity_id=a.id AND c.recipe_hash=${MATCHING_RECIPE_HASH}
    WHERE r.singleton AND a.id IN (${sql.join(
      activityIds.map((id) => sql`${id}::bigint`),
      sql`, `,
    )})
      AND a.athlete=${actor.athleteId}
      AND EXISTS (SELECT 1 FROM "user" u WHERE u.id=${actor.userId} AND u.athlete_id=${actor.athleteId} AND ${connected})
  `)
    ).rows;
  };
  const responseFor = (
    actor: Actor,
    activityId: string,
    row: ResultRow,
  ): ActivityPlacesResponse => {
    const version = matchingVersion({
      snapshotId: row.snapshot_id,
      revision: row.catalogue_revision,
    });
    if (row.result) {
      const result = activityPlacesResponseSchema.parse(row.result);
      if (
        result.userId !== actor.userId ||
        result.activityId !== activityId ||
        result.streamGeneration !== row.generation ||
        result.streamRevision !== row.revision ||
        result.catalogueSnapshotId !== row.snapshot_id ||
        result.matcherVersion !== MATCHING_RECIPE.matcherVersion
      )
        throw new Error('Stored matching scope mismatch');
      return {
        ...result,
        matchingVersion: version,
        resultRevision: row.result_revision,
      };
    }
    return {
      userId: actor.userId,
      activityId,
      status: !row.current
        ? 'missing_streams'
        : !row.snapshot_id
          ? 'unavailable'
          : 'pending',
      streamGeneration: row.generation,
      streamRevision: row.revision,
      catalogueSnapshotId: row.snapshot_id,
      matcherVersion: MATCHING_RECIPE.matcherVersion,
      matchingVersion: version,
      resultRevision: null,
      places: [],
    };
  };
  return {
    catalogue,
    /** One bounded query for all activity results on a sync page; never matches
     * or fetches streams. The manifest and rows share a database snapshot. */
    async sync(actor: Actor, activityIds: string[]) {
      return database.transaction(
        async (tx) => {
          const row = (
            await tx.execute<{ snapshot_id: string | null; revision: string }>(
              sql`SELECT ${preferredCatalogue} AS snapshot_id, revision::text FROM place_catalogue_revision WHERE singleton`,
            )
          ).rows[0];
          if (!row) throw new Error('Missing place catalogue revision');
          const version = matchingVersion({
            snapshotId: row.snapshot_id,
            revision: row.revision,
          });
          const rows = await readRows(actor, activityIds, tx.execute.bind(tx));
          return {
            version,
            results: new Map(
              rows.map((result) => [
                result.activity_id,
                responseFor(actor, result.activity_id, result),
              ]),
            ),
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async version(actor: Actor) {
      const row = (
        await database.execute<{
          snapshot_id: string | null;
          revision: string;
        }>(sql`
        SELECT ${preferredCatalogue} AS snapshot_id,r.revision::text FROM "user" u CROSS JOIN place_catalogue_revision r
        WHERE u.id=${actor.userId} AND u.athlete_id=${actor.athleteId} AND r.singleton AND ${connected}
      `)
      ).rows[0];
      if (!row) throw new ActivityPlacesUnavailableError();
      return {
        version: matchingVersion({
          snapshotId: row.snapshot_id,
          revision: row.revision,
        }),
      };
    },
    async read(
      actor: Actor,
      activityId: string,
    ): Promise<ActivityPlacesResponse> {
      const row = await database.transaction(
        (tx) =>
          readRows(actor, [activityId], tx.execute.bind(tx)).then(
            (rows) => rows[0],
          ),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      if (!row) throw new ActivityPlacesUnavailableError();
      const latest = (await readRows(actor, [activityId]))[0];
      if (!latest) throw new ActivityPlacesUnavailableError();
      const identity = (value: typeof row) =>
        canonicalJson([
          value.generation,
          value.revision,
          value.source_version,
          value.current,
          value.snapshot_id,
          value.catalogue_revision,
        ]);
      // A worker completing the same inputs may replace the check between
      // reads. Returning the earlier pending response is safe and keeps its
      // polling active; only changed inputs/authorization must reject the read.
      if (identity(latest) !== identity(row))
        throw new ActivityPlacesInputChangedError();
      return responseFor(actor, activityId, row);
    },
    async acquire(): Promise<string | null> {
      const token = randomUUID();
      const row = (
        await database.execute(sql`INSERT INTO place_matching_lease(key,token,expires_at) VALUES (${KEY},${token}::uuid,clock_timestamp()+interval '2 minutes')
        ON CONFLICT(key) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at WHERE place_matching_lease.expires_at<=clock_timestamp() RETURNING token`)
      ).rows[0];
      return row ? token : null;
    },
    async release(token: string) {
      await database.execute(
        sql`UPDATE place_matching_lease SET expires_at=clock_timestamp() WHERE key=${KEY} AND token=${token}::uuid`,
      );
    },
    async candidates(
      catalogue: MatchingCatalogue,
      limit: number,
      activityIds?: string[],
    ): Promise<MatchingCandidate[]> {
      const rows = (
        await database.execute<StoredCandidate>(sql`
        SELECT a.id::text AS activity_id,u.id AS user_id,u.athlete_id AS athlete_id,s.generation,s.revision::text,s.source_version,a.map_bbox,a.start_latlng
        FROM activities a JOIN "user" u ON u.athlete_id=a.athlete JOIN activity_streams s ON s.activity_id=a.id
        LEFT JOIN activity_place_checks c ON c.activity_id=a.id AND c.recipe_hash=${MATCHING_RECIPE_HASH}
        WHERE ${connected} AND ${current} ${
          activityIds
            ? sql`AND a.id IN (${sql.join(
                activityIds.map((id) => sql`${id}::bigint`),
                sql`, `,
              )})`
            : sql``
        } AND (NOT COALESCE((${sameInput(catalogue)}),false) OR (c.result IS NULL AND (c.retry_at IS NULL OR c.retry_at<=clock_timestamp())))
        ORDER BY c.checked_at ASC NULLS FIRST,a.id DESC LIMIT ${limit}
      `)
      ).rows;
      return rows.map((row) => ({
        activityId: row.activity_id,
        userId: row.user_id,
        athleteId: row.athlete_id,
        generation: row.generation,
        revision: row.revision,
        sourceVersion: row.source_version,
        locationHint: { bounds: row.map_bbox, start: row.start_latlng },
      }));
    },
    async readInput(
      candidate: MatchingCandidate,
    ): Promise<ActivityPlaceInput | null> {
      const row = (
        await database.execute<{ payload: unknown; too_large: boolean }>(sql`
        SELECT ${tooLarge} AS too_large, CASE WHEN NOT (${tooLarge}) THEN jsonb_build_object('latlng',s.payload->'latlng','time',s.payload->'time','distance',s.payload->'distance','altitude',s.payload->'altitude') END AS payload
        FROM activities a JOIN activity_streams s ON s.activity_id=a.id
        WHERE ${eligible({ userId: candidate.userId, athleteId: candidate.athleteId, authentication: 'bearer' }, candidate.activityId)} AND ${current}
          AND s.generation=${candidate.generation} AND s.revision=${candidate.revision}::bigint AND s.source_version=${candidate.sourceVersion}
      `)
      ).rows[0];
      return row
        ? {
            generation: candidate.generation,
            revision: candidate.revision,
            payload: row.payload,
            too_large: row.too_large,
          }
        : null;
    },
    async commit(
      token: string,
      catalogue: MatchingCatalogue,
      candidate: MatchingCandidate,
      response: ActivityPlacesResponse | null,
    ): Promise<boolean> {
      if (response) {
        activityPlacesResponseSchema.parse(response);
        if (
          response.userId !== candidate.userId ||
          response.activityId !== candidate.activityId ||
          response.streamGeneration !== candidate.generation ||
          response.streamRevision !== candidate.revision ||
          response.catalogueSnapshotId !== catalogue.snapshotId ||
          response.matcherVersion !== MATCHING_RECIPE.matcherVersion ||
          response.status === 'pending' ||
          response.status === 'unavailable'
        )
          throw new Error('Matching commit identity mismatch');
      }
      return database.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('statement_timeout','10000',true)`,
        );
        const lease = (
          await tx.execute(
            sql`SELECT token FROM place_matching_lease WHERE key=${KEY} AND token=${token}::uuid AND expires_at>clock_timestamp() FOR UPDATE`,
          )
        ).rows[0];
        if (!lease) return false;
        const revision = (
          await tx.execute<{ revision: string }>(
            sql`SELECT revision::text FROM place_catalogue_revision WHERE singleton FOR SHARE`,
          )
        ).rows[0];
        if (revision?.revision !== catalogue.revision) return false;
        const active = (
          await tx.execute<{ snapshot_id: string | null }>(
            sql`SELECT ${preferredCatalogue} AS snapshot_id`,
          )
        ).rows[0];
        if (active?.snapshot_id !== catalogue.snapshotId) return false;
        const user = (
          await tx.execute(
            sql`SELECT id FROM "user" WHERE id=${candidate.userId} AND athlete_id=${candidate.athleteId} FOR KEY SHARE`,
          )
        ).rows[0];
        if (!user) return false;
        const account = (
          await tx.execute(
            sql`SELECT id FROM account WHERE "userId"=${candidate.userId} AND "providerId"='strava' AND "accountId"=${String(candidate.athleteId)} AND revoked_at IS NULL AND scheduled_erasure_at IS NULL AND (COALESCE("accessToken",access_token,'')<>'' OR COALESCE("refreshToken",refresh_token,'')<>'') ORDER BY id LIMIT 1 FOR SHARE`,
          )
        ).rows[0];
        if (!account) return false;
        const activity = (
          await tx.execute(
            sql`SELECT id FROM activities WHERE id=${candidate.activityId}::bigint AND athlete=${candidate.athleteId} FOR SHARE`,
          )
        ).rows[0];
        if (!activity) return false;
        const stream = (
          await tx.execute(
            sql`SELECT s.activity_id FROM activity_streams s JOIN activities a ON a.id=s.activity_id WHERE s.activity_id=${candidate.activityId}::bigint AND ${current} AND s.generation=${candidate.generation} AND s.revision=${candidate.revision}::bigint AND s.source_version=${candidate.sourceVersion} FOR SHARE OF s`,
          )
        ).rows[0];
        if (!stream) return false;
        await tx.execute(sql`INSERT INTO activity_place_checks(activity_id,recipe_hash,user_id,stream_generation,stream_revision,source_version,catalogue_snapshot_id,catalogue_revision,matcher_version,discovery_version,parameters_hash,result,result_revision,checked_at,retry_at,error)
          VALUES(${candidate.activityId}::bigint,${MATCHING_RECIPE_HASH},${candidate.userId},${candidate.generation},${candidate.revision}::bigint,${candidate.sourceVersion},${catalogue.snapshotId},${catalogue.revision}::bigint,${MATCHING_RECIPE.matcherVersion},${MATCHING_RECIPE.discoveryVersion},${MATCHING_RECIPE.parametersHash},${response ? JSON.stringify(response) : null}::jsonb,${randomUUID()}::uuid,clock_timestamp(),CASE WHEN ${response === null} THEN clock_timestamp()+interval '5 minutes' END,${response === null ? 'matching_failed' : null})
          ON CONFLICT(activity_id,recipe_hash) DO UPDATE SET user_id=EXCLUDED.user_id,stream_generation=EXCLUDED.stream_generation,stream_revision=EXCLUDED.stream_revision,source_version=EXCLUDED.source_version,catalogue_snapshot_id=EXCLUDED.catalogue_snapshot_id,catalogue_revision=EXCLUDED.catalogue_revision,matcher_version=EXCLUDED.matcher_version,discovery_version=EXCLUDED.discovery_version,parameters_hash=EXCLUDED.parameters_hash,result=EXCLUDED.result,result_revision=EXCLUDED.result_revision,checked_at=EXCLUDED.checked_at,retry_at=EXCLUDED.retry_at,error=EXCLUDED.error`);
        // Matching is part of the activity aggregate. Publishing through the
        // existing feed keeps older clients compatible and removes no-match
        // visits by replacing the whole bundle, atomically with this check.
        await createChangesRepository(database).record(
          [
            {
              athleteId: candidate.athleteId,
              entityType: 'activity',
              entityId: candidate.activityId,
              operation: 'upsert',
            },
          ],
          tx,
        );
        return true;
      });
    },
  };
}
export type PlaceMatchingRepository = ReturnType<
  typeof createPlaceMatchingRepository
>;
