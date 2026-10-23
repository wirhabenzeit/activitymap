import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { z } from 'zod';

import type { Actor } from '~/server/auth/actor';
import { activityPlaces, activityStreams, places } from '~/server/db/schema';
import type {
  ActivityMatchInput,
  PlaceMatch,
  RunIdentity,
} from '~/server/places/run-types';
import {
  type PlaceRelation,
  parseActivityPlaceEvidence,
} from '~/server/places/types';
import {
  rawActivityStreamsSchema,
  streamActivityIdSchema,
} from '~/server/strava/streams';

import {
  ActivityPlacesUnavailableError,
  lockPlaceAccount,
  lockPlaceSource,
  validatePlaceActor,
} from './activity-places-access';

export { ActivityPlacesUnavailableError } from './activity-places-access';

const nonblank = z.string().trim().min(1);
const revision = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/)
  .refine(
    (value) =>
      value.length <= 19 && BigInt(value) <= 9_223_372_036_854_775_807n,
    'Revision exceeds PostgreSQL bigint',
  );
const tokensSchema = z.strictObject({
  generation: nonblank,
  revision,
  sourceVersion: nonblank,
});
const identitySchema = z.strictObject({
  runId: z.uuid(),
  catalogueSnapshotId: nonblank,
  matcherVersion: nonblank,
  parametersHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export class ActivityPlaceRunLockedError extends Error {
  constructor() {
    super('Another manual place run is already active for this athlete');
    this.name = 'ActivityPlaceRunLockedError';
  }
}

function assertPlaceEvidence(
  match: PlaceMatch,
  place: typeof places.$inferSelect,
): void {
  const allowed = new Set<PlaceRelation>();
  if (place.subtypes.includes('peak')) allowed.add('reached_peak');
  if (place.subtypes.includes('natural_saddle')) allowed.add('reached_saddle');
  if (place.subtypes.includes('road_trail_pass')) allowed.add('crossed_pass');
  if (place.kinds.includes('pass')) allowed.add('visited_pass');
  if (
    place.subtypes.includes('alpine_hut') ||
    place.subtypes.includes('wilderness_hut')
  ) {
    allowed.add('arrived_at_hut');
  }
  for (const episode of match.evidence.encounters.flatMap(
    (encounter) => encounter.fragments,
  )) {
    const point = episode.source.point;
    const elevation = episode.source.mapped_elevation_m;
    if (
      point.longitude !== place.location.longitude ||
      point.latitude !== place.location.latitude ||
      (place.elevationM === null
        ? elevation !== undefined
        : elevation === undefined ||
          Math.fround(elevation) !== Math.fround(place.elevationM)) ||
      episode.relation_assessments.some(
        ({ relation }) => !allowed.has(relation),
      )
    ) {
      throw new Error(
        `Encounter evidence disagrees with catalogue place ${match.placeId}`,
      );
    }
  }
}

/** Inject a verified local/direct client; this module never opens a default DB. */
export function createActivityPlacesRepository(client: postgres.Sql) {
  const database = drizzle(client);
  return {
    async withAthleteRunLock<T>(
      actor: Actor,
      work: () => Promise<T>,
    ): Promise<T> {
      validatePlaceActor(actor);
      // The reserved session holds a lock while work uses this pool. A single
      // connection would deadlock even though PostgreSQL itself is available.
      if (client.options.max < 2) {
        throw new Error(
          'Manual place runs require a direct pool with at least two connections',
        );
      }
      const key = `activitymap-place-matcher:${actor.athleteId}`;
      const session = await client.reserve();
      let acquired = false;
      try {
        const result = await session<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired
        `;
        acquired = result[0]?.acquired === true;
        if (!acquired) throw new ActivityPlaceRunLockedError();
        await database.transaction(async (tx) => {
          if (!(await lockPlaceAccount(tx, actor)))
            throw new ActivityPlacesUnavailableError();
        });
        return await work();
      } finally {
        try {
          if (acquired)
            await session`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
        } finally {
          session.release();
        }
      }
    },

    async readInput(
      actor: Actor,
      activityId: string,
    ): Promise<ActivityMatchInput | null> {
      streamActivityIdSchema.parse(activityId);
      return database.transaction(async (tx) => {
        const source = await lockPlaceSource(tx, actor, activityId);
        if (!source) throw new ActivityPlacesUnavailableError();
        const [stream] = await tx
          .select()
          .from(activityStreams)
          .where(eq(activityStreams.activityId, BigInt(activityId)))
          .for('share');
        if (
          !stream?.fetchedAt ||
          stream.invalidatedAt ||
          stream.payload == null ||
          stream.sourceVersion !== source.sourceVersion
        )
          return null;
        const payload = rawActivityStreamsSchema.parse(stream.payload);
        if (!payload.latlng?.data.length) return null;
        return {
          activityId,
          tokens: {
            generation: stream.generation,
            revision: stream.revision.toString(),
            sourceVersion: source.sourceVersion,
          },
          payload,
        };
      });
    },

    async publish(
      actor: Actor,
      input: ActivityMatchInput,
      runIdentity: RunIdentity,
      inputMatches: PlaceMatch[],
    ): Promise<'published' | 'superseded'> {
      const activityId = streamActivityIdSchema.parse(input.activityId);
      const tokens = tokensSchema.parse(input.tokens);
      const identity = identitySchema.parse(runIdentity);
      const payload = rawActivityStreamsSchema.parse(input.payload);
      const samples = payload.latlng?.data.length ?? 0;
      if (!samples) throw new Error('Cannot publish without stored GPS input');
      if (inputMatches.length > 5_000)
        throw new Error('Too many matched places');
      const seen = new Set<string>();
      const matches = inputMatches.map((match) => {
        const placeId = z.uuid().parse(match.placeId);
        if (seen.has(placeId))
          throw new Error('Duplicate activity/place membership');
        seen.add(placeId);
        const evidence = parseActivityPlaceEvidence(match.evidence);
        if (
          evidence.encounters.some((encounter) =>
            encounter.fragments.some(
              (episode) => episode.end_gps_index >= samples,
            ),
          )
        ) {
          throw new Error(
            'Encounter references a GPS index outside its exact input stream',
          );
        }
        return { placeId, evidence };
      });

      return database.transaction(async (tx) => {
        const source = await lockPlaceSource(tx, actor, activityId);
        if (source?.sourceVersion !== tokens.sourceVersion) return 'superseded';
        const [stream] = await tx
          .select({
            generation: activityStreams.generation,
            revision: activityStreams.revision,
            sourceVersion: activityStreams.sourceVersion,
            fetchedAt: activityStreams.fetchedAt,
            invalidatedAt: activityStreams.invalidatedAt,
            hasPayload: sql<boolean>`${activityStreams.payload} IS NOT NULL`,
          })
          .from(activityStreams)
          .where(eq(activityStreams.activityId, BigInt(activityId)))
          .for('update');
        if (
          !stream?.fetchedAt ||
          stream.invalidatedAt ||
          !stream.hasPayload ||
          stream.generation !== tokens.generation ||
          stream.revision.toString() !== tokens.revision ||
          stream.sourceVersion !== tokens.sourceVersion
        )
          return 'superseded';

        // Freeze the catalogue through publication, including a zero-match
        // replacement. No source lock/fetch attempt/lease is ever repurposed.
        await tx.execute(sql`LOCK TABLE places IN SHARE MODE`);
        const catalogue = await tx.execute<{
          total: number;
          matching: number;
        }>(sql`
          SELECT count(*)::integer AS total,
            count(*) FILTER (WHERE catalogue_snapshot_id = ${identity.catalogueSnapshotId})::integer AS matching
          FROM places
        `);
        if (
          !catalogue[0]?.total ||
          catalogue[0].total !== catalogue[0].matching
        ) {
          throw new Error('Requested frozen catalogue is unavailable or mixed');
        }
        if (matches.length) {
          const stored = await tx
            .select()
            .from(places)
            .where(
              inArray(
                places.id,
                matches.map(({ placeId }) => placeId),
              ),
            );
          const byId = new Map(stored.map((place) => [place.id, place]));
          for (const match of matches) {
            const place = byId.get(match.placeId);
            if (place?.catalogueSnapshotId !== identity.catalogueSnapshotId) {
              throw new Error(
                `Matched place is absent from the requested catalogue: ${match.placeId}`,
              );
            }
            assertPlaceEvidence(match, place);
          }
        }
        await tx
          .delete(activityPlaces)
          .where(eq(activityPlaces.activityId, BigInt(activityId)));
        for (let offset = 0; offset < matches.length; offset += 500) {
          await tx.insert(activityPlaces).values(
            matches.slice(offset, offset + 500).map((match) => ({
              activityId: BigInt(activityId),
              placeId: match.placeId,
              supportedRelations: match.evidence.supported_relations,
              encounters: match.evidence.encounters,
              evidenceVersion: match.evidence.evidence_version,
              inputStreamGeneration: tokens.generation,
              inputStreamRevision: BigInt(tokens.revision),
              inputSourceVersion: tokens.sourceVersion,
              catalogueSnapshotId: identity.catalogueSnapshotId,
              matcherVersion: identity.matcherVersion,
              parametersHash: identity.parametersHash,
              runId: identity.runId,
            })),
          );
        }
        return 'published';
      });
    },
  };
}
