'use client';

import type { Activity, Photo } from '~/server/db/schema';
import {
  deleteCachedActivitiesByIds,
  deleteCachedPhotosByActivityIds,
  deleteCachedPhotosByIds,
  getSyncMeta,
  setSyncMeta,
  upsertCachedActivities,
  upsertCachedPhotos,
} from '~/lib/offline/db';

type SerializedActivity = Omit<
  Activity,
  'start_date' | 'start_date_local' | 'last_updated'
> & {
  start_date: string;
  start_date_local: string;
  last_updated: string | null;
};

type SerializedPhoto = Omit<Photo, 'uploaded_at' | 'created_at'> & {
  uploaded_at: string | null;
  created_at: string | null;
};

type OfflineSyncResponse = {
  activities: SerializedActivity[];
  photos: SerializedPhoto[];
  deletedActivityIds: number[];
  deletedPhotoIds: string[];
  cursor: string;
  serverTime: string;
};

export type OfflineSyncResult = {
  activityCount: number;
  photoCount: number;
  deletedActivityCount: number;
  deletedPhotoCount: number;
  cursor: string;
  serverTime: string;
  mode: 'bootstrap' | 'changes';
};

const toAuthScope = (userId: string): string => `auth:${userId}`;

const toDate = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toActivity = (raw: SerializedActivity): Activity => ({
  ...raw,
  start_date: new Date(raw.start_date),
  start_date_local: new Date(raw.start_date_local),
  last_updated: toDate(raw.last_updated),
});

const toPhoto = (raw: SerializedPhoto): Photo => ({
  ...raw,
  uploaded_at: toDate(raw.uploaded_at),
  created_at: toDate(raw.created_at),
});

const fetchSyncResponse = async (
  endpoint: string,
  signal?: AbortSignal,
): Promise<OfflineSyncResponse> => {
  const response = await fetch(endpoint, {
    method: 'GET',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `Offline sync request failed (${response.status})`);
  }

  return response.json() as Promise<OfflineSyncResponse>;
};

const applySyncResponse = async (
  userScope: string,
  response: OfflineSyncResponse,
): Promise<void> => {
  const activities = response.activities.map(toActivity);
  const photos = response.photos.map(toPhoto);

  await Promise.all([
    upsertCachedActivities(userScope, activities),
    upsertCachedPhotos(userScope, photos),
    deleteCachedActivitiesByIds(userScope, response.deletedActivityIds),
    deleteCachedPhotosByActivityIds(userScope, response.deletedActivityIds),
    deleteCachedPhotosByIds(userScope, response.deletedPhotoIds),
  ]);

  await setSyncMeta({
    userScope,
    cursor: response.cursor,
    lastSyncAt: response.serverTime,
    updatedAt: new Date().toISOString(),
  });
};

export const bootstrapOfflineData = async ({
  userId,
  signal,
}: {
  userId: string;
  signal?: AbortSignal;
}): Promise<OfflineSyncResult> => {
  const userScope = toAuthScope(userId);
  const response = await fetchSyncResponse('/api/offline/bootstrap', signal);
  await applySyncResponse(userScope, response);

  return {
    activityCount: response.activities.length,
    photoCount: response.photos.length,
    deletedActivityCount: response.deletedActivityIds.length,
    deletedPhotoCount: response.deletedPhotoIds.length,
    cursor: response.cursor,
    serverTime: response.serverTime,
    mode: 'bootstrap',
  };
};

export const syncOfflineData = async ({
  userId,
  signal,
}: {
  userId: string;
  signal?: AbortSignal;
}): Promise<OfflineSyncResult> => {
  const userScope = toAuthScope(userId);
  const meta = await getSyncMeta(userScope);

  if (!meta?.cursor) {
    return bootstrapOfflineData({ userId, signal });
  }

  const params = new URLSearchParams({ since: meta.cursor });
  const response = await fetchSyncResponse(`/api/offline/changes?${params.toString()}`, signal);
  await applySyncResponse(userScope, response);

  return {
    activityCount: response.activities.length,
    photoCount: response.photos.length,
    deletedActivityCount: response.deletedActivityIds.length,
    deletedPhotoCount: response.deletedPhotoIds.length,
    cursor: response.cursor,
    serverTime: response.serverTime,
    mode: 'changes',
  };
};
