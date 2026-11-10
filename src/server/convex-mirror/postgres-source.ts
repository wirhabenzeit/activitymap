import 'server-only';

import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { activityDTOSchema, toActivityDTO } from '~/contracts/v1/activity';
import { toActivityStreamSummaryDTO } from '~/contracts/v1/activity-streams';
import { toPhotoDTO } from '~/contracts/v1/photo';
import type { Actor } from '~/server/auth/actor';
import { db } from '~/server/db';
import {
  activities as activitiesTable,
  activityStreams,
  photos,
  syncChanges,
  users,
} from '~/server/db/schema';
import { activitiesRepository } from '~/server/repositories/activities';
import { createActivityStreamsRepository } from '~/server/repositories/activity-streams';
import { changesRepository } from '~/server/repositories/changes';
import { createPlaceMatchingRepository } from '~/server/repositories/place-matching';

import type { MirrorSource } from './mirror';
import type { ParityPostgres } from './parity';

/** The server actor for a shadow owner (an application user ID). */
export async function shadowActor(userId: string): Promise<Actor> {
  const [user] = await db
    .select({ athleteId: users.athlete_id })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.athleteId) throw new Error('Shadow owner has no athlete');
  return { userId, athleteId: user.athleteId, authentication: 'cookie' };
}

/** Postgres serves a stored stream set while it was fetched and has not been
 * invalidated, whatever the latest refresh attempt did. */
function currentStreams(ids: string[]) {
  return and(
    inArray(
      activityStreams.activityId,
      ids.map((id) => BigInt(id)),
    ),
    isNotNull(activityStreams.fetchedAt),
    isNull(activityStreams.invalidatedAt),
    isNotNull(activityStreams.payload),
  );
}

/** The current photos of the actor's activities among `activityIds`. */
async function photosOf(actor: Actor, activityIds: string[]) {
  const ids = activityIds.map(Number).filter(Number.isSafeInteger);
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(photos)
    .where(
      and(
        eq(photos.athlete_id, actor.athleteId),
        inArray(photos.activity_id, ids),
      ),
    );
  return rows.map(toPhotoDTO);
}

export function postgresMirrorSource(actor: Actor): MirrorSource {
  const places = createPlaceMatchingRepository();
  return {
    latestSequence: () => changesRepository.latestSequence(actor.athleteId),

    async changedActivities(afterSequence, since, limit) {
      const rows = await db
        .select({
          id: syncChanges.entityId,
          sequence: sql<string>`max(${syncChanges.sequence})::text`,
        })
        .from(syncChanges)
        .where(
          and(
            eq(syncChanges.athleteId, actor.athleteId),
            eq(syncChanges.entityType, 'activity'),
            sql`(${syncChanges.sequence} > ${afterSequence} OR ${syncChanges.changedAt} > ${since.toISOString()}::timestamptz)`,
          ),
        )
        .groupBy(syncChanges.entityId)
        .orderBy(sql`max(${syncChanges.sequence})`)
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        sequence: Number(row.sequence),
      }));
    },

    async activityIds(afterId, limit) {
      const rows = await activitiesRepository.findPageByAthlete(
        actor.athleteId,
        { afterId: afterId === null ? 0 : Number(afterId), limit },
      );
      return rows.map((row) => String(row.id));
    },

    async activities(ids) {
      const rows = await activitiesRepository.findManyByIds(
        ids.map(Number).filter(Number.isSafeInteger),
      );
      return rows
        .filter((row) => row.athlete === actor.athleteId)
        .map((row) => {
          // Streams and matches are derived state that Convex publishes itself.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { streams, placeMatches, ...dto } = toActivityDTO(row);
          return dto;
        });
    },

    async recordings(ids) {
      if (ids.length === 0) return [];
      return db
        .select({
          id: sql<string>`${activityStreams.activityId}::text`,
          generation: activityStreams.generation,
          revision: sql<string>`${activityStreams.revision}::text`,
        })
        .from(activityStreams)
        .where(currentStreams(ids));
    },

    async payloads(ids) {
      if (ids.length === 0) return [];
      // Identity is re-read with the payload, so a refresh landing in between
      // is published under its own generation and revision.
      const rows = await db
        .select({
          id: sql<string>`${activityStreams.activityId}::text`,
          generation: activityStreams.generation,
          revision: sql<string>`${activityStreams.revision}::text`,
          fetchedAt: activityStreams.fetchedAt,
          payload: activityStreams.payload,
        })
        .from(activityStreams)
        .where(currentStreams(ids));
      return rows.map((row) => ({
        ...row,
        fetchedAt: row.fetchedAt?.toISOString() ?? null,
        payload: row.payload!,
      }));
    },

    async matches(ids) {
      const { version, results } = await places.sync(actor, ids);
      return { version, results: [...results.values()] };
    },

    async changedPhotos(afterSequence, since, limit) {
      const rows = await db
        .select({
          id: syncChanges.entityId,
          sequence: sql<string>`max(${syncChanges.sequence})::text`,
        })
        .from(syncChanges)
        .where(
          and(
            eq(syncChanges.athleteId, actor.athleteId),
            eq(syncChanges.entityType, 'photo'),
            sql`(${syncChanges.sequence} > ${afterSequence} OR ${syncChanges.changedAt} > ${since.toISOString()}::timestamptz)`,
          ),
        )
        .groupBy(syncChanges.entityId)
        .orderBy(sql`max(${syncChanges.sequence})`)
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        sequence: Number(row.sequence),
      }));
    },

    async photoActivities(ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .select({ id: photos.unique_id, activityId: photos.activity_id })
        .from(photos)
        .where(
          and(
            eq(photos.athlete_id, actor.athleteId),
            inArray(photos.unique_id, ids),
          ),
        );
      return rows.map((row) => ({
        id: row.id,
        activityId: String(row.activityId),
      }));
    },

    photos: (activityIds) => photosOf(actor, activityIds),
  };
}

/** What the v1 handlers serve for the owner from Postgres: bootstrap items
 * (`toActivityDTO` plus place matches) and stream summaries. */
export function postgresParitySource(actor: Actor): ParityPostgres {
  const places = createPlaceMatchingRepository();
  const streams = createActivityStreamsRepository();
  const changesOf =
    (entityType: 'activity' | 'photo') =>
    (...conditions: Parameters<typeof and>) =>
      and(
        eq(syncChanges.athleteId, actor.athleteId),
        eq(syncChanges.entityType, entityType),
        ...conditions,
      );
  const activityChanges = changesOf('activity');
  const latest = async (entityType: 'activity' | 'photo', ids: string[]) => {
    if (ids.length === 0)
      return new Map<string, { sequence: number; changedAt: Date }>();
    const rows = await db
      .select({
        id: syncChanges.entityId,
        sequence: sql<string>`max(${syncChanges.sequence})::text`,
        changedAt: sql<string>`(extract(epoch from max(${syncChanges.changedAt})) * 1000)::text`,
      })
      .from(syncChanges)
      .where(changesOf(entityType)(inArray(syncChanges.entityId, ids)))
      .groupBy(syncChanges.entityId);
    return new Map(
      rows.map((row) => [
        row.id,
        {
          sequence: Number(row.sequence),
          changedAt: new Date(Number(row.changedAt)),
        },
      ]),
    );
  };
  return {
    async activityIds() {
      const rows = await db
        .select({ id: sql<string>`${activitiesTable.id}::text` })
        .from(activitiesTable)
        .where(eq(activitiesTable.athlete, actor.athleteId))
        .orderBy(asc(activitiesTable.id));
      return rows.map((row) => row.id);
    },

    async changedSince(since, limit) {
      const rows = await db
        .select({ id: syncChanges.entityId })
        .from(syncChanges)
        .where(
          activityChanges(
            sql`${syncChanges.changedAt} > ${since.toISOString()}::timestamptz`,
          ),
        )
        .groupBy(syncChanges.entityId)
        .orderBy(sql`max(${syncChanges.sequence}) desc`)
        .limit(limit);
      return rows.map((row) => row.id);
    },

    latestChanges: (ids) => latest('activity', ids),
    latestPhotoChanges: (ids) => latest('photo', ids),

    photos: (activityIds) => photosOf(actor, activityIds),

    async activities(ids) {
      const rows = await activitiesRepository.findManyByIds(
        ids.map(Number).filter(Number.isSafeInteger),
      );
      const items = rows
        .filter((row) => row.athlete === actor.athleteId)
        .map(toActivityDTO);
      const { results } = await places.sync(
        actor,
        items.map((item) => item.id),
      );
      return items.map((item) =>
        activityDTOSchema.parse({
          ...item,
          placeMatches: results.get(item.id),
        }),
      );
    },

    async summaries(ids) {
      const reads = [];
      // The v1 summaries route accepts up to 100 IDs per request.
      for (let i = 0; i < ids.length; i += 100)
        reads.push(
          ...(await streams.readSummaries(actor, ids.slice(i, i + 100))),
        );
      return reads.map(toActivityStreamSummaryDTO);
    },
  };
}

/** Upload a recording file to a Convex upload URL, retrying network errors
 * (an upload URL is only consumed by a successful upload). */
export async function uploadRecording(url: string, file: Uint8Array) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/gzip' },
        body: new Uint8Array(file),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
      return ((await response.json()) as { storageId: string }).storageId;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}
