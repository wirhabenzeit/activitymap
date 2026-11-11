import 'server-only';

import type { Activity, Photo } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';

import { StravaClient, isStravaActivityNotFoundError } from './client';
import { transformStravaActivity, transformStravaPhoto } from './transforms';
import { type StravaPhoto } from './types';
import type { StravaActivity } from './types';
import { type FetchActivitiesInput, fetchActivitiesSchema } from './validators';

export class StravaPersistenceError extends Error {
  constructor(
    options: { cause: unknown },
    public readonly upstreamSucceeded = true,
  ) {
    super('The Strava response could not be persisted', options);
    this.name = 'StravaPersistenceError';
  }
}

export type FetchStravaActivitiesResult = {
  activities: Activity[];
  photos: Photo[];
  notFoundIds: number[];
  failedIds?: number[];
  /** Internal errors retained so single-activity callers can classify them. */
  failures?: Array<{ activityId: number; error: unknown }>;
  /** IDs whose returned photo sets are authoritative, including known-empty. */
  photoRefreshAuthoritativeIds?: number[];
  photoRefreshFailedIds?: number[];
  /** Internal errors retained so the application service can classify a partial refresh. */
  photoRefreshFailures?: Array<{ activityId: number; error: unknown }>;
};

type ActivityDetailClient = Pick<
  StravaClient,
  'getActivity' | 'getActivities' | 'getActivityPhotos'
>;

export type FetchStravaActivitiesDeps = {
  createClient?: (accessToken: string) => ActivityDetailClient;
};

/** Strava returned an activity whose owner is not the athlete it was fetched for. */
export class ForeignStravaActivityError extends Error {
  constructor(
    readonly activityId: number,
    readonly athleteId: number,
  ) {
    super(
      `Strava activity ${activityId} is not owned by athlete ${athleteId}; refusing to store it`,
    );
    this.name = 'ForeignStravaActivityError';
  }
}

export async function fetchRequestedStravaActivities(
  client: Pick<ActivityDetailClient, 'getActivity'>,
  activityIds: number[],
): Promise<{
  activities: StravaActivity[];
  notFoundIds: number[];
  failedIds: number[];
  failures: Array<{ activityId: number; error: unknown }>;
}> {
  const notFoundIds: number[] = [];
  const failedIds: number[] = [];
  const failures: Array<{ activityId: number; error: unknown }> = [];
  const results = await Promise.all(
    activityIds.map(async (id) => {
      try {
        return await client.getActivity(id);
      } catch (error: unknown) {
        if (isStravaActivityNotFoundError(error)) {
          logger.warn(
            `Activity ${id} explicitly reported missing by Strava. Marked for removal.`,
          );
          notFoundIds.push(id);
          return null;
        }
        logger.error('Failed to fetch individual activity:', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
        failedIds.push(id);
        failures.push({ activityId: id, error });
        return null;
      }
    }),
  );
  return {
    activities: results.filter(
      (activity): activity is StravaActivity => activity !== null,
    ),
    notFoundIds,
    failedIds,
    failures,
  };
}

export async function fetchStravaActivities(
  input: FetchActivitiesInput,
  deps: FetchStravaActivitiesDeps = {},
): Promise<FetchStravaActivitiesResult> {
  const {
    accessToken,
    before,
    after,
    page,
    per_page,
    activityIds: requestedActivityIds,
    athleteId,
    limit,
    requireExisting,
  } = fetchActivitiesSchema.parse(input);

  // Token refresh is now handled outside this function
  const client = (deps.createClient ?? StravaClient.withAccessToken)(
    accessToken,
  );
  const photos: Photo[] = [];
  let notFoundIds: number[] = [];
  let failedIds: number[] = [];
  let failures: Array<{ activityId: number; error: unknown }> = [];
  const photoRefreshFailed = new Set<number>();
  const photoRefreshFailures: Array<{ activityId: number; error: unknown }> =
    [];

  let stravaActivitiesResult: StravaActivity[];

  if (requestedActivityIds) {
    const requested = await fetchRequestedStravaActivities(
      client,
      requestedActivityIds,
    );
    stravaActivitiesResult = requested.activities;
    notFoundIds = requested.notFoundIds;
    failedIds = requested.failedIds;
    failures = requested.failures;
  } else {
    // List/Summary mode
    const params: Parameters<StravaClient['getActivities']>[0] = {
      per_page: per_page ?? limit,
    };
    if (before) params.before = before;
    if (after) params.after = after;
    if (page) params.page = page;

    stravaActivitiesResult = await client.getActivities(params);
  }

  // Every row below is stored with `athlete: athleteId`. Strava can return
  // activities the token's athlete can see but does not own (e.g. a public
  // activity requested by id, as an unauthenticated webhook payload could
  // ask for), so anything whose Strava owner differs is never persisted or
  // returned: storing it would re-attribute another athlete's activity and
  // photos to this one.
  const fetchedActivities = (stravaActivitiesResult ?? []).filter((act) => {
    if (act.athlete?.id === athleteId) return true;
    const error = new ForeignStravaActivityError(act.id, athleteId);
    logger.warn(error.message);
    failedIds.push(act.id);
    failures.push({ activityId: act.id, error });
    return false;
  });

  if (fetchedActivities.length === 0) {
    return {
      activities: [],
      photos: [],
      notFoundIds,
      failedIds,
      failures,
      photoRefreshAuthoritativeIds: [],
      photoRefreshFailedIds: [],
    };
  }

  const photoRefreshSucceeded = new Set<number>();
  // Every detail path owns the photo follow-up; callers cannot silently skip it.
  if (requestedActivityIds) {
    // Explicit zero counts on a detailed response are authoritative, including
    // removal of previously stored photos. An explicit user refresh still
    // checks the endpoint independently of the counts.
    for (const activity of fetchedActivities) {
      if (
        !requireExisting &&
        activity.total_photo_count === 0 &&
        activity.photo_count === 0
      ) {
        photoRefreshSucceeded.add(activity.id);
      }
    }
    const photoCandidates = fetchedActivities.filter(
      (activity) => !photoRefreshSucceeded.has(activity.id),
    );
    const photoFetchPromises = photoCandidates.map(async (act) => {
      try {
        const activityPhotos: StravaPhoto[] = await client.getActivityPhotos(
          act.id,
        );
        photoRefreshSucceeded.add(act.id);

        return activityPhotos
          .map((photo) => transformStravaPhoto(photo, athleteId))
          .filter((photo): photo is Photo => photo !== null);
      } catch (error) {
        photoRefreshFailed.add(act.id);
        photoRefreshFailures.push({ activityId: act.id, error });
        logger.error(`Failed to fetch photos for activity ${act.id}:`, error);
        return [];
      }
    });

    const photoResults = await Promise.all(photoFetchPromises);
    photos.push(...photoResults.flat());
  }

  const activitiesToProcess = fetchedActivities.map((act) => {
    // Only mark as complete if we explicitly requested IDs (Detail View)
    // OR if it has a detailed polyline (strong indicator of detail view).
    const isComplete = !!requestedActivityIds || !!act.map?.polyline;
    const transformed = transformStravaActivity(act, isComplete, {
      photosCurrent: photoRefreshSucceeded.has(act.id),
    });
    if (photoRefreshFailed.has(act.id))
      transformed.photosState = 'refresh_required';
    return transformed;
  });

  const dbActivities = activitiesToProcess.map((act) => ({
    ...act,
    athlete: athleteId,
  }));

  // Fetched only: the caller stores the result in the library.
  const savedActivities: Activity[] = dbActivities;

  return {
    activities: savedActivities,
    photos,
    notFoundIds,
    failedIds,
    failures,
    photoRefreshAuthoritativeIds: [...photoRefreshSucceeded],
    photoRefreshFailedIds: [...photoRefreshFailed],
    photoRefreshFailures,
  };
}
