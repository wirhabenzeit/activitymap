import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';

import { auth } from '~/lib/auth';
import { db } from '~/server/db';
import {
  activities,
  activityDeletions,
  photoDeletions,
  photos,
  type Activity,
  type Photo,
} from '~/server/db/schema';
import { getUserInternal } from '~/server/db/internal';

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

const getAthleteIdForSession = async (): Promise<number> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user?.id) {
    throw new Error('Not authenticated');
  }

  const user = await getUserInternal(session.user.id);
  if (!user?.athlete_id) {
    throw new Error('User has no athlete_id linked');
  }

  return user.athlete_id;
};

export const getOfflineBootstrap = async (): Promise<OfflineSyncPayload> => {
  const athleteId = await getAthleteIdForSession();
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
  sinceRaw: string | null,
): Promise<OfflineSyncPayload> => {
  const athleteId = await getAthleteIdForSession();
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
