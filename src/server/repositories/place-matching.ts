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
export type MatchingWrite = {
  candidate: MatchingCandidate;
  response: ActivityPlacesResponse | null;
};
export type MatchingBatchCommit = { committed: string[]; fenceLost: boolean };
export type MatchingBatchInputs = {
  inputs: Map<string, ActivityPlaceInput>;
  consumed: number;
};
export type MatchingCoverage = {
  userId: string;
  total: number;
  eligible: number;
  checked: number;
  limited: number;
  pending: number;
  retryWaiting: number;
  failed: number;
  waitingForStreams: number;
};
const matchingRequests = (candidates: readonly MatchingCandidate[]) =>
  sql`jsonb_to_recordset(${JSON.stringify(
    candidates.map((candidate) => ({
      activity_id: candidate.activityId,
      user_id: candidate.userId,
      athlete_id: candidate.athleteId,
      generation: candidate.generation,
      revision: candidate.revision,
      source_version: candidate.sourceVersion,
    })),
  )}::jsonb) AS requested(activity_id bigint,user_id text,athlete_id bigint,generation text,revision bigint,source_version text)`;
const matchesRequest = sql`a.id=requested.activity_id AND a.athlete=requested.athlete_id AND u.id=requested.user_id AND u.athlete_id=requested.athlete_id
  AND s.generation=requested.generation AND s.revision=requested.revision AND s.source_version=requested.source_version`;
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

/** One leased worker with a durable pending index. Exact input/version tuples
 * remain authoritative; crashes leave unacknowledged work eligible to resume. */
export function createPlaceMatchingRepository(database: typeof db = db) {
  let pendingQueueReady: boolean | undefined;
  const hasPendingQueue = async () => {
    pendingQueueReady ??=
      (
        await database.execute<{ ready: boolean }>(sql`
          SELECT to_regclass('public.place_matching_pending') IS NOT NULL
            AND to_regclass('public.place_matching_queue_state') IS NOT NULL AS ready
        `)
      ).rows[0]?.ready ?? false;
    return pendingQueueReady;
  };
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
  const readInputs = async (
    candidates: readonly MatchingCandidate[],
    sampleBudget = 100_000,
    sizeCache: Map<string, number> = new Map(),
  ): Promise<MatchingBatchInputs> => {
    if (!candidates.length) return { inputs: new Map(), consumed: 0 };
    if (
      candidates.length > 500 ||
      new Set(candidates.map((c) => c.activityId)).size !== candidates.length ||
      !Number.isInteger(sampleBudget) ||
      sampleBudget < 1 ||
      sampleBudget > 100_000
    )
      throw new Error('Invalid matching input batch');
    // A small sizing query prevents transferring 500 long GPS payloads just
    // because their route centres are nearby. Both queries fence identities.
    const sizeKey = (candidate: MatchingCandidate) =>
      canonicalJson([
        candidate.activityId,
        candidate.userId,
        candidate.athleteId,
        candidate.generation,
        candidate.revision,
        candidate.sourceVersion,
      ]);
    const unknown = candidates.filter(
      (candidate) => !sizeCache.has(sizeKey(candidate)),
    );
    const sizes = unknown.length
      ? (
          await database.execute<{ activity_id: string; samples: number }>(sql`
      SELECT a.id::text AS activity_id, CASE WHEN ${tooLarge} THEN 0
        WHEN jsonb_typeof(s.payload->'latlng'->'data')='array' THEN jsonb_array_length(s.payload->'latlng'->'data') ELSE 0 END AS samples
      FROM ${matchingRequests(unknown)} JOIN activities a ON a.id=requested.activity_id
      JOIN "user" u ON u.id=requested.user_id JOIN activity_streams s ON s.activity_id=a.id
      WHERE ${matchesRequest} AND ${current} AND ${connected}
    `)
        ).rows
      : [];
    const keys = new Map(
      unknown.map((candidate) => [candidate.activityId, sizeKey(candidate)]),
    );
    for (const row of sizes)
      sizeCache.set(keys.get(row.activity_id)!, row.samples);
    const byId = new Map(
      candidates
        .filter((candidate) => sizeCache.has(sizeKey(candidate)))
        .map((candidate) => [
          candidate.activityId,
          sizeCache.get(sizeKey(candidate))!,
        ]),
    );
    let consumed = 0,
      samples = 0;
    while (consumed < candidates.length && samples < sampleBudget) {
      samples += byId.get(candidates[consumed]!.activityId) ?? 0;
      consumed++;
    }
    const selected = candidates
      .slice(0, consumed)
      .filter((candidate) => byId.has(candidate.activityId));
    if (!selected.length) return { inputs: new Map(), consumed };
    const rows = (
      await database.execute<{
        activity_id: string;
        payload: unknown;
        too_large: boolean;
      }>(sql`
      SELECT a.id::text AS activity_id, ${tooLarge} AS too_large,
        CASE WHEN NOT (${tooLarge}) THEN jsonb_build_object('latlng',s.payload->'latlng','time',s.payload->'time','distance',s.payload->'distance','altitude',s.payload->'altitude') END AS payload
      FROM ${matchingRequests(selected)} JOIN activities a ON a.id=requested.activity_id
      JOIN "user" u ON u.id=requested.user_id JOIN activity_streams s ON s.activity_id=a.id
      WHERE ${matchesRequest} AND ${current} AND ${connected}
    `)
    ).rows;
    const identities = new Map(
      selected.map((candidate) => [candidate.activityId, candidate]),
    );
    return {
      consumed,
      inputs: new Map(
        rows.map((row) => {
          const candidate = identities.get(row.activity_id)!;
          return [
            row.activity_id,
            {
              generation: candidate.generation,
              revision: candidate.revision,
              payload: row.payload,
              too_large: row.too_large,
            },
          ];
        }),
      ),
    };
  };
  const commitMany = async (
    token: string,
    catalogue: MatchingCatalogue,
    writes: readonly MatchingWrite[],
  ): Promise<MatchingBatchCommit> => {
    if (!writes.length) return { committed: [], fenceLost: false };
    if (
      writes.length > 500 ||
      new Set(writes.map((write) => write.candidate.activityId)).size !==
        writes.length
    )
      throw new Error('Invalid matching write batch');
    for (const { candidate, response } of writes) {
      if (!response) continue;
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
    const candidates = writes.map((write) => write.candidate);
    const usePendingQueue = await hasPendingQueue();
    return database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('statement_timeout','10000',true)`,
      );
      const lease = (
        await tx.execute(
          sql`SELECT token FROM place_matching_lease WHERE key=${KEY} AND token=${token}::uuid AND expires_at>clock_timestamp() FOR UPDATE`,
        )
      ).rows[0];
      if (!lease) return { committed: [], fenceLost: true };
      const revision = (
        await tx.execute<{ revision: string }>(
          sql`SELECT revision::text FROM place_catalogue_revision WHERE singleton FOR SHARE`,
        )
      ).rows[0];
      if (revision?.revision !== catalogue.revision)
        return { committed: [], fenceLost: true };
      const active = (
        await tx.execute<{ snapshot_id: string | null }>(
          sql`SELECT ${preferredCatalogue} AS snapshot_id`,
        )
      ).rows[0];
      if (active?.snapshot_id !== catalogue.snapshotId)
        return { committed: [], fenceLost: true };
      // Lock the complete batch in deterministic order. Revalidate in the
      // following statement, after waits, before writing any private results.
      await tx.execute(
        sql`SELECT u.id FROM "user" u WHERE u.id IN (SELECT requested.user_id FROM ${matchingRequests(candidates)}) ORDER BY u.id FOR KEY SHARE OF u`,
      );
      await tx.execute(
        sql`SELECT c.id FROM account c WHERE c."providerId"='strava' AND EXISTS (SELECT 1 FROM ${matchingRequests(candidates)} WHERE c."userId"=requested.user_id AND c."accountId"=requested.athlete_id::text) ORDER BY c.id FOR SHARE OF c`,
      );
      await tx.execute(
        sql`SELECT a.id FROM activities a WHERE a.id IN (SELECT requested.activity_id FROM ${matchingRequests(candidates)}) ORDER BY a.id FOR SHARE OF a`,
      );
      await tx.execute(
        sql`SELECT s.activity_id FROM activity_streams s WHERE s.activity_id IN (SELECT requested.activity_id FROM ${matchingRequests(candidates)}) ORDER BY s.activity_id FOR SHARE OF s`,
      );
      const records = writes.map(({ candidate, response }) => ({
        activity_id: candidate.activityId,
        user_id: candidate.userId,
        athlete_id: candidate.athleteId,
        generation: candidate.generation,
        revision: candidate.revision,
        source_version: candidate.sourceVersion,
        result: response,
        result_revision: randomUUID(),
      }));
      const writeChecks = sql`
        INSERT INTO activity_place_checks(activity_id,recipe_hash,user_id,stream_generation,stream_revision,source_version,catalogue_snapshot_id,catalogue_revision,matcher_version,discovery_version,parameters_hash,result,result_revision,checked_at,retry_at,error)
        SELECT a.id,${MATCHING_RECIPE_HASH},u.id,s.generation,s.revision,s.source_version,${catalogue.snapshotId},${catalogue.revision}::bigint,
          ${MATCHING_RECIPE.matcherVersion},${MATCHING_RECIPE.discoveryVersion},${MATCHING_RECIPE.parametersHash},requested.result,requested.result_revision,
          clock_timestamp(),CASE WHEN requested.result IS NULL THEN clock_timestamp()+interval '5 minutes' END,CASE WHEN requested.result IS NULL THEN 'matching_failed' END
        FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS requested(activity_id bigint,user_id text,athlete_id bigint,generation text,revision bigint,source_version text,result jsonb,result_revision uuid)
        JOIN activities a ON a.id=requested.activity_id JOIN "user" u ON u.id=requested.user_id JOIN activity_streams s ON s.activity_id=a.id
        WHERE ${matchesRequest} AND ${current} AND ${connected}
        ORDER BY a.id
        ON CONFLICT(activity_id,recipe_hash) DO UPDATE SET user_id=EXCLUDED.user_id,stream_generation=EXCLUDED.stream_generation,stream_revision=EXCLUDED.stream_revision,source_version=EXCLUDED.source_version,catalogue_snapshot_id=EXCLUDED.catalogue_snapshot_id,catalogue_revision=EXCLUDED.catalogue_revision,matcher_version=EXCLUDED.matcher_version,discovery_version=EXCLUDED.discovery_version,parameters_hash=EXCLUDED.parameters_hash,result=EXCLUDED.result,result_revision=EXCLUDED.result_revision,checked_at=EXCLUDED.checked_at,retry_at=EXCLUDED.retry_at,error=EXCLUDED.error
        RETURNING activity_id,retry_at
      `;
      const rows = (
        await tx.execute<{ activity_id: string }>(
          usePendingQueue
            ? sql`
          WITH written AS (${writeChecks}),
          finished AS (
            DELETE FROM place_matching_pending p USING written w
            WHERE p.activity_id=w.activity_id AND w.retry_at IS NULL
          )
          SELECT activity_id::text FROM written
        `
            : sql`WITH written AS (${writeChecks}) SELECT activity_id::text FROM written`,
        )
      ).rows;
      const committed = rows.map((row) => row.activity_id);
      const committedSet = new Set(committed);
      await createChangesRepository(database).record(
        candidates
          .filter((candidate) => committedSet.has(candidate.activityId))
          .map((candidate) => ({
            athleteId: candidate.athleteId,
            entityType: 'activity',
            entityId: candidate.activityId,
            operation: 'upsert',
          })),
        tx,
      );
      return { committed, fenceLost: false };
    });
  };
  return {
    catalogue,
    /** Admin-only aggregate: current versions, including zero-encounter checks.
     * No GPS samples, place lists, names or credentials are loaded. Pending and
     * retryWaiting partition eligible work not yet checked; failed overlaps. */
    async coverage(catalogue: MatchingCatalogue): Promise<MatchingCoverage[]> {
      const eligible = sql`COALESCE((${current}),false)`;
      const checked = sql`eligible AND fresh AND has_result`;
      const failed = sql`eligible AND fresh AND NOT has_result`;
      const waiting = sql`${failed} AND retry_at>statement_timestamp()`;
      const count = (condition: ReturnType<typeof sql>) =>
        sql`count(*) FILTER (WHERE ${condition})::integer`;
      return (
        await database.execute<MatchingCoverage>(sql`
          -- Materialize the source/version facts once per activity. Inlining
          -- currentPlaceStreams into each aggregate repeats an expensive source
          -- hash (including whole-row JSON conversion) for every count.
          WITH inputs AS MATERIALIZED (
            SELECT u.id AS user_id, ${eligible} AS eligible,
              COALESCE((${sameInput(catalogue)}),false) AS fresh,
              c.result IS NOT NULL AS has_result,
              c.result->>'status' AS status,c.retry_at
            FROM activities a JOIN "user" u ON u.athlete_id=a.athlete
            LEFT JOIN activity_streams s ON s.activity_id=a.id
            LEFT JOIN activity_place_checks c ON c.activity_id=a.id AND c.recipe_hash=${MATCHING_RECIPE_HASH}
            WHERE ${connected}
          )
          SELECT user_id AS "userId",count(*)::integer AS total,
            ${count(sql`eligible`)} AS eligible,
            ${count(checked)} AS checked,
            ${count(sql`${checked} AND status<>'complete'`)} AS limited,
            ${count(sql`eligible AND (NOT fresh OR (NOT has_result AND (retry_at IS NULL OR retry_at<=statement_timestamp())))`)} AS pending,
            ${count(waiting)} AS "retryWaiting",
            ${count(failed)} AS failed,
            ${count(sql`NOT eligible`)} AS "waitingForStreams"
          FROM inputs GROUP BY user_id
        `)
      ).rows;
    },
    readInputs,
    commitMany,
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
      if (!catalogue.snapshotId) return [];
      const queued = await hasPendingQueue();
      if (queued) {
        // One atomic seed after catalogue/recipe changes. When unchanged, the
        // empty changed CTE makes the activity scan a never-executed branch.
        await database.execute(sql`
          WITH changed AS (
            INSERT INTO place_matching_queue_state(singleton,recipe_hash,catalogue_snapshot_id,catalogue_revision)
            VALUES(true,${MATCHING_RECIPE_HASH},${catalogue.snapshotId},${catalogue.revision}::bigint)
            ON CONFLICT(singleton) DO UPDATE SET recipe_hash=EXCLUDED.recipe_hash,
              catalogue_snapshot_id=EXCLUDED.catalogue_snapshot_id,catalogue_revision=EXCLUDED.catalogue_revision
            WHERE (place_matching_queue_state.recipe_hash,place_matching_queue_state.catalogue_snapshot_id,place_matching_queue_state.catalogue_revision)
              IS DISTINCT FROM (EXCLUDED.recipe_hash,EXCLUDED.catalogue_snapshot_id,EXCLUDED.catalogue_revision)
            RETURNING singleton
          )
          INSERT INTO place_matching_pending(activity_id,available_at)
          SELECT a.id,CASE WHEN COALESCE((${sameInput(catalogue)}),false) THEN COALESCE(c.retry_at,statement_timestamp()) ELSE statement_timestamp() END
          FROM activities a JOIN "user" u ON u.athlete_id=a.athlete
          JOIN activity_streams s ON s.activity_id=a.id
          LEFT JOIN activity_place_checks c ON c.activity_id=a.id AND c.recipe_hash=${MATCHING_RECIPE_HASH}
          WHERE EXISTS(SELECT 1 FROM changed) AND ${connected}
            AND s.fetched_at IS NOT NULL AND s.invalidated_at IS NULL
            AND s.last_attempt_status<>'invalidated' AND s.payload IS NOT NULL
            AND (NOT COALESCE((${sameInput(catalogue)}),false) OR c.result IS NULL)
          ON CONFLICT(activity_id) DO UPDATE SET available_at=LEAST(place_matching_pending.available_at,EXCLUDED.available_at)
        `);
        // Reconnection or manual reset can mark an already-current result.
        // Retire it using version metadata, without recomputing source hashes.
        await database.execute(sql`
          DELETE FROM place_matching_pending p USING activities a,"user" u,activity_streams s,activity_place_checks c
          WHERE a.id=p.activity_id AND u.athlete_id=a.athlete AND s.activity_id=a.id
            AND c.activity_id=a.id AND c.recipe_hash=${MATCHING_RECIPE_HASH}
            AND ${sameInput(catalogue)} AND c.result IS NOT NULL
        `);
      }
      const rows = (
        await database.execute<StoredCandidate>(sql`
        ${
          queued
            ? sql`WITH todo AS MATERIALIZED (
          SELECT a.id,c.checked_at FROM place_matching_pending p
          JOIN activities a ON a.id=p.activity_id JOIN "user" u ON u.athlete_id=a.athlete
          JOIN activity_streams s ON s.activity_id=a.id
          LEFT JOIN activity_place_checks c ON c.activity_id=a.id AND c.recipe_hash=${MATCHING_RECIPE_HASH}
          WHERE p.available_at<=statement_timestamp() AND ${connected}
            AND s.fetched_at IS NOT NULL AND s.invalidated_at IS NULL
            AND s.last_attempt_status<>'invalidated' AND s.payload IS NOT NULL
            AND (NOT COALESCE((${sameInput(catalogue)}),false) OR (c.result IS NULL AND (c.retry_at IS NULL OR c.retry_at<=statement_timestamp())))
            ${
              activityIds
                ? sql`AND a.id IN (${sql.join(
                    activityIds.map((id) => sql`${id}::bigint`),
                    sql`, `,
                  )})`
                : sql``
            }
          ORDER BY c.checked_at ASC NULLS FIRST,a.id DESC LIMIT ${limit}
        )`
            : sql``
        }
        SELECT a.id::text AS activity_id,u.id AS user_id,u.athlete_id AS athlete_id,s.generation,s.revision::text,s.source_version,a.map_bbox,a.start_latlng
        FROM ${queued ? sql`todo t JOIN activities a ON a.id=t.id` : sql`activities a`} JOIN "user" u ON u.athlete_id=a.athlete JOIN activity_streams s ON s.activity_id=a.id
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
      return (
        (await readInputs([candidate])).inputs.get(candidate.activityId) ?? null
      );
    },
    async commit(
      token: string,
      catalogue: MatchingCatalogue,
      candidate: MatchingCandidate,
      response: ActivityPlacesResponse | null,
    ): Promise<boolean> {
      return (
        await commitMany(token, catalogue, [{ candidate, response }])
      ).committed.includes(candidate.activityId);
    },
  };
}
export type PlaceMatchingRepository = ReturnType<
  typeof createPlaceMatchingRepository
>;
