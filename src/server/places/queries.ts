import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { z } from 'zod';

import { sportTypes } from '~/contracts/sport';
import type { Actor } from '~/server/auth/actor';
import { activities, activityPlaces, places } from '~/server/db/schema';
import {
  ActivityPlacesUnavailableError,
  type PlaceTransaction,
  lockPlaceAccount,
} from '~/server/repositories/activity-places-access';
import { streamActivityIdSchema } from '~/server/strava/streams';

import { parseEvaluationContext, runActorSchema } from './run-manifest';
import type { EvaluationContext } from './run-types';
import {
  parseActivityPlaceEvidence,
  placeKindSchema,
  placeRelationSchema,
} from './types';

const filtersSchema = z
  .strictObject({
    sportTypes: z
      .array(z.enum(sportTypes))
      .min(1)
      .max(sportTypes.length)
      .optional(),
    startDateLocal: z.iso.date().optional(),
    endDateLocal: z.iso.date().optional(),
    relation: placeRelationSchema.optional(),
    kind: placeKindSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((filters, context) => {
    if (
      filters.startDateLocal &&
      filters.endDateLocal &&
      filters.startDateLocal > filters.endDateLocal
    )
      context.addIssue({
        code: 'custom',
        message: 'Local date range is inverted',
      });
    if (
      filters.sportTypes &&
      new Set(filters.sportTypes).size !== filters.sportTypes.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate sport filter' });
  });

export type PlaceQueryFilters = z.input<typeof filtersSchema>;
export function parsePlaceQueryFilters(input: unknown = {}) {
  return filtersSchema.parse(input);
}

type ScopeRow = {
  activity_id: string;
  athlete_id: string;
  sport_type: string;
  start_date_local: string;
  generation: string | null;
  revision: string | null;
  source_version: string | null;
  authoritative_source: string;
  usable: boolean;
  stored_count: number;
  current_count: number;
};
type ResultStatus = 'current' | 'stale' | 'missing';
export type PlaceEvaluationSummary = {
  basis: 'explicit_evaluation_scope';
  scopeActivities: number;
  evaluatedActivities: number;
  incompleteActivities: number;
  matchingScopeActivities: number;
  matchingEvaluatedActivities: number;
  unavailableActivities: number;
  excludedByFilters: number;
  complete: boolean;
};

function idsSql(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::bigint`),
    sql`, `,
  );
}

function validateContext(
  actor: Actor,
  input: EvaluationContext,
): EvaluationContext {
  const caller = runActorSchema.parse(actor);
  const context = parseEvaluationContext(input);
  if (
    caller.userId !== context.actor.userId ||
    caller.athleteId !== context.actor.athleteId
  )
    throw new ActivityPlacesUnavailableError();
  return context;
}

async function evaluateScope(
  tx: PlaceTransaction,
  actor: Actor,
  context: EvaluationContext,
) {
  if (!(await lockPlaceAccount(tx, actor)))
    throw new ActivityPlacesUnavailableError();

  // Read metadata only. A retained stream row is not authoritative when the
  // activity source projection changed, even if invalidation was missed.
  const rows = await tx.execute<ScopeRow>(sql`
    SELECT a.id::text AS activity_id, a.athlete::text AS athlete_id,
      a.sport_type,
      to_char(a.start_date_local, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS start_date_local,
      s.generation, s.revision::text AS revision, s.source_version,
      md5(activity_stream_source(a)::text) AS authoritative_source,
      COALESCE(s.fetched_at IS NOT NULL AND s.invalidated_at IS NULL
        AND s.last_attempt_status <> 'invalidated' AND s.payload IS NOT NULL
        AND 'latlng' = ANY(s.available_types), false) AS usable,
      (SELECT count(*)::integer FROM activity_places ap WHERE ap.activity_id = a.id) AS stored_count,
      (SELECT count(*)::integer FROM activity_places ap
        JOIN places p ON p.id = ap.place_id
        WHERE ap.activity_id = a.id
          AND ap.input_stream_generation = s.generation
          AND ap.input_stream_revision = s.revision
          AND ap.input_source_version = s.source_version
          AND ap.catalogue_snapshot_id = ${context.catalogueSnapshotId}
          AND p.catalogue_snapshot_id = ${context.catalogueSnapshotId}
          AND ap.matcher_version = ${context.matcherVersion}
          AND ap.parameters_hash = ${context.parametersHash}
          AND ap.run_id = ${context.runId}::uuid) AS current_count
    FROM activities a
    LEFT JOIN activity_streams s ON s.activity_id = a.id
    WHERE a.id IN (${idsSql(context.activityIds)})
  `);
  if (rows.some((row) => row.athlete_id !== String(actor.athleteId)))
    throw new ActivityPlacesUnavailableError();

  const [catalogue] = await tx.execute<{ current: boolean }>(sql`
    SELECT count(*) > 0 AND bool_and(catalogue_snapshot_id = ${context.catalogueSnapshotId}) AS current
    FROM places
  `);
  const byActivity = new Map(rows.map((row) => [row.activity_id, row]));
  const records = new Map(
    context.records.map((record) => [record.activityId, record]),
  );
  const statuses = new Map<string, ResultStatus>();
  for (const id of context.activityIds) {
    const row = byActivity.get(id);
    const record = records.get(id);
    if (!row || record?.outcome !== 'complete' || !record.published) {
      statuses.set(id, (row?.stored_count ?? 0) > 0 ? 'stale' : 'missing');
      continue;
    }
    const current =
      catalogue?.current &&
      row.usable &&
      record.input?.generation === row.generation &&
      record.input.revision === row.revision &&
      record.input.sourceVersion === row.source_version &&
      row.source_version === row.authoritative_source &&
      row.stored_count === record.matchCount &&
      row.current_count === record.matchCount;
    statuses.set(id, current ? 'current' : 'stale');
  }
  return { byActivity, records, statuses };
}

function summarizeScope(
  context: EvaluationContext,
  scope: Awaited<ReturnType<typeof evaluateScope>>,
  filters: ReturnType<typeof parsePlaceQueryFilters>,
) {
  const matchingIds = context.activityIds.filter((id) => {
    const activity = scope.byActivity.get(id);
    if (!activity) return false;
    const day = activity.start_date_local.slice(0, 10);
    return (
      (!filters.sportTypes ||
        filters.sportTypes.some((sport) => sport === activity.sport_type)) &&
      (!filters.startDateLocal || day >= filters.startDateLocal) &&
      (!filters.endDateLocal || day <= filters.endDateLocal)
    );
  });
  const eligibleIds = matchingIds.filter(
    (id) => scope.statuses.get(id) === 'current',
  );
  const evaluated = [...scope.statuses.values()].filter(
    (status) => status === 'current',
  ).length;
  const evaluation: PlaceEvaluationSummary = {
    basis: 'explicit_evaluation_scope',
    scopeActivities: context.activityIds.length,
    evaluatedActivities: evaluated,
    incompleteActivities: context.activityIds.length - evaluated,
    matchingScopeActivities: matchingIds.length,
    matchingEvaluatedActivities: eligibleIds.length,
    unavailableActivities: context.activityIds.length - scope.byActivity.size,
    excludedByFilters: scope.byActivity.size - matchingIds.length,
    complete: evaluated === context.activityIds.length,
  };
  return { eligibleIds, evaluation };
}

function membershipFilter(
  ids: string[],
  filters: ReturnType<typeof parsePlaceQueryFilters>,
) {
  return and(
    sql`${activityPlaces.activityId} IN (${idsSql(ids)})`,
    sql`cardinality(${activityPlaces.supportedRelations}) > 0`,
    filters.relation
      ? sql`${filters.relation} = ANY(${activityPlaces.supportedRelations})`
      : undefined,
    filters.kind ? sql`${filters.kind} = ANY(${places.kinds})` : undefined,
  );
}

/** Every read uses one snapshot, explicit run context, and an eligible actor. */
export function createPlaceQueries(client: postgres.Sql) {
  const db = drizzle(client);
  return {
    async getActivityPlaces(
      actor: Actor,
      activityId: string,
      input: EvaluationContext,
    ) {
      const id = streamActivityIdSchema.parse(activityId);
      const context = validateContext(actor, input);
      if (!context.activityIds.includes(id))
        throw new ActivityPlacesUnavailableError();
      return db.transaction(
        async (tx) => {
          const scope = await evaluateScope(tx, actor, context);
          if (!scope.byActivity.has(id))
            throw new ActivityPlacesUnavailableError();
          const status = scope.statuses.get(id)!;
          const record = scope.records.get(id);
          const rows =
            status === 'current'
              ? await tx
                  .select({
                    id: places.id,
                    displayName: places.displayName,
                    kinds: places.kinds,
                    subtypes: places.subtypes,
                    supportedRelations: activityPlaces.supportedRelations,
                    encounters: activityPlaces.encounters,
                    evidenceVersion: activityPlaces.evidenceVersion,
                    computedAt: activityPlaces.computedAt,
                  })
                  .from(activityPlaces)
                  .innerJoin(places, eq(places.id, activityPlaces.placeId))
                  .where(eq(activityPlaces.activityId, BigInt(id)))
                  .orderBy(asc(places.displayName), asc(places.id))
              : [];
          return {
            activityId: id,
            status,
            outcome: record?.outcome ?? null,
            places: rows.map((row) => ({
              id: row.id,
              displayName: row.displayName,
              kinds: row.kinds,
              subtypes: row.subtypes,
              evidence: parseActivityPlaceEvidence({
                evidence_version: row.evidenceVersion,
                supported_relations: row.supportedRelations,
                encounters: row.encounters,
              }),
              computedAt: row.computedAt.toISOString(),
            })),
          };
        },
        { isolationLevel: 'repeatable read' },
      );
    },

    async listActivitiesForPlace(
      actor: Actor,
      placeId: string,
      inputFilters: PlaceQueryFilters,
      input: EvaluationContext,
    ) {
      const id = z.uuid().parse(placeId);
      const filters = parsePlaceQueryFilters(inputFilters);
      const context = validateContext(actor, input);
      return db.transaction(
        async (tx) => {
          const scope = await evaluateScope(tx, actor, context);
          const { eligibleIds, evaluation } = summarizeScope(
            context,
            scope,
            filters,
          );
          const rows = eligibleIds.length
            ? await tx
                .select({
                  activityId: sql<string>`${activities.id}::text`,
                  name: activities.name,
                  sportType: activities.sport_type,
                  startDateLocal: sql<string>`to_char(${activities.start_date_local}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`,
                  supportedRelations: activityPlaces.supportedRelations,
                })
                .from(activityPlaces)
                .innerJoin(
                  activities,
                  eq(activityPlaces.activityId, activities.id),
                )
                .innerJoin(places, eq(places.id, activityPlaces.placeId))
                .where(
                  and(
                    eq(places.id, id),
                    membershipFilter(eligibleIds, filters),
                  ),
                )
                .orderBy(desc(activities.start_date_local), desc(activities.id))
                .limit(filters.limit + 1)
                .offset(filters.offset)
            : [];
          return {
            items: rows.slice(0, filters.limit),
            hasMore: rows.length > filters.limit,
            evaluation,
          };
        },
        { isolationLevel: 'repeatable read' },
      );
    },

    async getTopPlaces(
      actor: Actor,
      inputFilters: PlaceQueryFilters,
      input: EvaluationContext,
    ) {
      const filters = parsePlaceQueryFilters(inputFilters);
      const context = validateContext(actor, input);
      return db.transaction(
        async (tx) => {
          const scope = await evaluateScope(tx, actor, context);
          const { eligibleIds, evaluation } = summarizeScope(
            context,
            scope,
            filters,
          );
          const activityCount = sql<number>`count(DISTINCT ${activityPlaces.activityId})::integer`;
          const rows = eligibleIds.length
            ? await tx
                .select({
                  placeId: places.id,
                  displayName: places.displayName,
                  kinds: places.kinds,
                  activityCount,
                })
                .from(activityPlaces)
                .innerJoin(places, eq(places.id, activityPlaces.placeId))
                .where(membershipFilter(eligibleIds, filters))
                .groupBy(places.id, places.displayName, places.kinds)
                .orderBy(
                  desc(activityCount),
                  asc(places.displayName),
                  asc(places.id),
                )
                .limit(filters.limit + 1)
                .offset(filters.offset)
            : [];
          return {
            items: rows.slice(0, filters.limit),
            hasMore: rows.length > filters.limit,
            evaluation,
          };
        },
        { isolationLevel: 'repeatable read' },
      );
    },
  };
}
