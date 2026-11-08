import 'server-only';

import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { toActivityDTO } from '~/contracts/v1/activity';
import type { Actor } from '~/server/auth/actor';
import { db } from '~/server/db';
import { activityStreams, syncChanges } from '~/server/db/schema';
import { activitiesRepository } from '~/server/repositories/activities';
import { changesRepository } from '~/server/repositories/changes';
import { createPlaceMatchingRepository } from '~/server/repositories/place-matching';

import type { MirrorSource } from './mirror';

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
