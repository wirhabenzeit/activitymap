import 'server-only';

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { db } from '~/server/db';
import {
  activities,
  activityDeletions,
  photoDeletions,
  photos,
  type Activity,
  type Photo,
} from '~/server/db/schema';

import type { Actor } from '~/server/auth/actor';

/**
 * Application service for the offline bootstrap/changes reads used by the
 * `/api/offline/*` Route Handlers (issue #120's "synchronization queries").
 *
 * This is a timestamp-cursor stopgap, not the lossless, sequence-numbered
 * change feed described in docs/swiftui-backend-preparation-plan.md - that
 * feed (and the `changes` repository it would justify) is issue #122/#123's
 * job. Moved here unchanged in behavior from the former
 * `~/server/offline/sync.ts`, except that it now takes an already-resolved
 * `Actor` instead of reading `next/headers`/the Better Auth session itself,
 * so it has no framework dependency and Route Handlers and Server Actions
 * can call it identically.
 */

const EPOCH_ISO = new Date(0).toISOString();

export type OfflineSyncPayload = {
  activities: Activity[];
  photos: Photo[];
  deletedActivityIds: number[];
  deletedPhotoIds: string[];
  cursor: string;
  serverTime: string;
};

const parseSinceCursor = (raw: string | null): Date => {
  if (!raw) return new Date(0);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0);
  }
  return parsed;
};

const getActivityWatermark = (activity: Activity): string =>
  (activity.last_updated ?? activity.start_date).toISOString();

const getPhotoWatermark = (photo: Photo): string =>
  (photo.created_at ?? photo.uploaded_at ?? new Date(0)).toISOString();

const maxIso = (a: string, b: string): string => (a >= b ? a : b);

export const getOfflineBootstrap = async (
  actor: Actor,
): Promise<OfflineSyncPayload> => {
  const athleteId = actor.athleteId;
  const serverTime = new Date().toISOString();

  const [activityRows, photoRows] = await Promise.all([
    db
      .select()
      .from(activities)
      .where(eq(activities.athlete, athleteId))
      .orderBy(desc(activities.start_date)),
    db
      .select()
      .from(photos)
      .where(eq(photos.athlete_id, athleteId))
      .orderBy(
        sql`COALESCE(${photos.created_at}, ${photos.uploaded_at}, to_timestamp(0)) ASC`,
        asc(photos.unique_id),
      ),
  ]);

  let cursor = EPOCH_ISO;
  for (const activity of activityRows) {
    cursor = maxIso(cursor, getActivityWatermark(activity));
  }
  for (const photo of photoRows) {
    cursor = maxIso(cursor, getPhotoWatermark(photo));
  }

  return {
    activities: activityRows,
    photos: photoRows,
    deletedActivityIds: [],
    deletedPhotoIds: [],
    cursor,
    serverTime,
  };
};

export const getOfflineChanges = async (
  actor: Actor,
  sinceRaw: string | null,
): Promise<OfflineSyncPayload> => {
  const athleteId = actor.athleteId;
  const since = parseSinceCursor(sinceRaw);
  const serverTime = new Date().toISOString();

  const [activityRows, photoRows, activityDeletionRows, photoDeletionRows] = await Promise.all([
    db
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.athlete, athleteId),
          sql`COALESCE(${activities.last_updated}, ${activities.start_date}) > ${since}`,
        ),
      )
      .orderBy(
        sql`COALESCE(${activities.last_updated}, ${activities.start_date}) ASC`,
        asc(activities.id),
      ),
    db
      .select()
      .from(photos)
      .where(
        and(
          eq(photos.athlete_id, athleteId),
          sql`COALESCE(${photos.created_at}, ${photos.uploaded_at}, to_timestamp(0)) > ${since}`,
        ),
      )
      .orderBy(
        sql`COALESCE(${photos.created_at}, ${photos.uploaded_at}, to_timestamp(0)) ASC`,
        asc(photos.unique_id),
      ),
    db
      .select({
        activity_id: activityDeletions.activity_id,
        deleted_at: activityDeletions.deleted_at,
      })
      .from(activityDeletions)
      .where(
        and(
          eq(activityDeletions.athlete_id, athleteId),
          sql`${activityDeletions.deleted_at} > ${since}`,
        ),
      )
      .orderBy(asc(activityDeletions.deleted_at), asc(activityDeletions.activity_id)),
    db
      .select({
        photo_id: photoDeletions.photo_id,
        deleted_at: photoDeletions.deleted_at,
      })
      .from(photoDeletions)
      .where(
        and(
          eq(photoDeletions.athlete_id, athleteId),
          sql`${photoDeletions.deleted_at} > ${since}`,
        ),
      )
      .orderBy(asc(photoDeletions.deleted_at), asc(photoDeletions.photo_id)),
  ]);

  let cursor = since.toISOString();
  for (const activity of activityRows) {
    cursor = maxIso(cursor, getActivityWatermark(activity));
  }
  for (const photo of photoRows) {
    cursor = maxIso(cursor, getPhotoWatermark(photo));
  }
  for (const deletion of activityDeletionRows) {
    cursor = maxIso(
      cursor,
      (deletion.deleted_at ?? new Date(0)).toISOString(),
    );
  }
  for (const deletion of photoDeletionRows) {
    cursor = maxIso(
      cursor,
      (deletion.deleted_at ?? new Date(0)).toISOString(),
    );
  }

  const deletedActivityIds = Array.from(
    new Set(activityDeletionRows.map((row) => row.activity_id)),
  );
  const deletedPhotoIds = Array.from(
    new Set(photoDeletionRows.map((row) => row.photo_id)),
  );

  return {
    activities: activityRows,
    photos: photoRows,
    deletedActivityIds,
    deletedPhotoIds,
    cursor,
    serverTime,
  };
};
