import 'server-only';

import { getAccountInternal } from '~/server/db/internal';
import type { Activity, Photo } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import { StravaApiError, StravaClient } from '~/server/strava/client';
import {
  fetchStravaActivities,
  StravaPersistenceError,
  type FetchStravaActivitiesResult,
} from '~/server/strava/service';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';
import { EXTERNAL_EFFECTS_DISABLED_MESSAGE } from '~/server/config/external-effects';
import { transformStravaActivity } from '~/server/strava/transforms';
import { type UpdatableActivity } from '~/server/strava/types';
import {
  deleteActivitiesSchema,
  updateActivityInputSchema,
  type UpdateActivityInput,
} from '~/server/strava/validators';

import type { Actor } from '~/server/auth/actor';
import {
  activitiesRepository,
  type ActivitiesRepository,
} from '~/server/repositories/activities';
import {
  photosRepository,
  type PhotosRepository,
} from '~/server/repositories/photos';

/**
 * Application service for activity/photo reads, updates, and Strava
 * refreshes (issue #120). This file intentionally has no React, `next/*`,
 * `"use server"`, or Route Handler imports - see
 * `~/server/application/framework-boundary.test.ts`, which enforces that
 * structurally. Route Handlers and Server Actions both call these functions
 * directly, passing an `Actor` they resolved themselves
 * (`~/server/auth/actor.ts`).
 */

export type ActivityMutationErrorCode =
  | 'activity_unavailable'
  | 'strava_not_connected'
  | 'external_effects_disabled'
  | 'rate_limited'
  | 'upstream_rejected'
  | 'upstream_unavailable'
  | 'local_persistence_failed';

/** Stable service-level failure shared by the web and v1 boundaries. */
export class ActivityMutationError extends Error {
  constructor(
    public readonly code: ActivityMutationErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly retryAfterSeconds?: number,
    public readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ActivityMutationError';
  }
}

type AccountResolver = typeof getAccountInternal;

export type ActivitiesServiceDeps = {
  activitiesRepo?: ActivitiesRepository;
  photosRepo?: PhotosRepository;
  resolveAccount?: AccountResolver;
  createClient?: (accessToken: string) => Pick<StravaClient, 'updateActivity'>;
  fetchActivities?: (
    input: Parameters<typeof fetchStravaActivities>[0],
  ) => Promise<FetchStravaActivitiesResult>;
};

const defaultDeps = {
  get activitiesRepo() {
    return activitiesRepository;
  },
  get photosRepo() {
    return photosRepository;
  },
  get resolveAccount() {
    return getAccountInternal;
  },
  get createClient() {
    return (accessToken: string) => StravaClient.withAccessToken(accessToken);
  },
  get fetchActivities() {
    return fetchStravaActivities;
  },
};

function resolveDeps(deps: ActivitiesServiceDeps) {
  return {
    activitiesRepo: deps.activitiesRepo ?? defaultDeps.activitiesRepo,
    photosRepo: deps.photosRepo ?? defaultDeps.photosRepo,
    resolveAccount: deps.resolveAccount ?? defaultDeps.resolveAccount,
    createClient: deps.createClient ?? defaultDeps.createClient,
    fetchActivities: deps.fetchActivities ?? defaultDeps.fetchActivities,
  };
}

/** Every activity owned by the actor's athlete, newest first. */
export async function getUserActivities(
  actor: Actor,
  opts: { limit?: number; offset?: number } = {},
  deps: ActivitiesServiceDeps = {},
): Promise<Activity[]> {
  const { activitiesRepo } = resolveDeps(deps);
  return activitiesRepo.findManyByAthlete(actor.athleteId, opts);
}

/**
 * Look up activities by internal id, scoped to the requesting actor.
 *
 * This is the fix for the previously-unauthenticated `getActivitiesByIds`:
 * it never trusts the caller's id list to already belong to them. Any id in
 * `ids` that resolves to a different athlete's activity is silently dropped
 * from the result, exactly as if it did not exist - the caller cannot
 * distinguish "not found" from "not yours".
 */
export async function getActivitiesForActor(
  actor: Actor,
  ids: number[],
  deps: ActivitiesServiceDeps = {},
): Promise<Activity[]> {
  if (ids.length === 0) return [];
  const { activitiesRepo } = resolveDeps(deps);
  const found = await activitiesRepo.findManyByIds(ids);
  return found.filter((activity) => activity.athlete === actor.athleteId);
}

/** Photos belonging to the actor's athlete. */
export async function getPhotosForActor(
  actor: Actor,
  deps: ActivitiesServiceDeps = {},
): Promise<Photo[]> {
  const { photosRepo } = resolveDeps(deps);
  return photosRepo.findManyByAthlete(actor.athleteId);
}

async function requireOwnedActivity(
  activitiesRepo: ActivitiesRepository,
  actor: Actor,
  activityId: number,
): Promise<Activity> {
  const [existing] = await activitiesRepo.findManyByIds([activityId]);
  if (existing?.athlete !== actor.athleteId)
    throw new ActivityMutationError(
      'activity_unavailable',
      'The activity is unavailable.',
      404,
    );
  return existing;
}

function mutationFailure(error: unknown): ActivityMutationError {
  if (error instanceof ActivityMutationError) return error;
  if (error instanceof StravaPersistenceError)
    return new ActivityMutationError(
      'local_persistence_failed',
      error.upstreamSucceeded
        ? 'Strava completed the request, but the result was not saved locally.'
        : 'The upstream result could not be reconciled locally.',
      503,
      true,
      undefined,
      {
        upstreamSucceeded: error.upstreamSucceeded,
        recovery: 'reconcile_or_retry_explicitly',
      },
      { cause: error },
    );
  if (error instanceof StravaBudgetExceededError)
    return new ActivityMutationError(
      'rate_limited',
      'The shared Strava request budget is exhausted.',
      429,
      true,
      error.retryAfterSeconds,
      undefined,
      { cause: error },
    );
  if (error instanceof StravaApiError) {
    if (error.status === 404)
      return new ActivityMutationError(
        'activity_unavailable',
        'The activity is unavailable.',
        404,
        false,
        undefined,
        undefined,
        { cause: error },
      );
    if (error.status === 429)
      return new ActivityMutationError(
        'rate_limited',
        'Strava rate-limited the request.',
        429,
        true,
        60,
        undefined,
        { cause: error },
      );
    if (error.status === 401 || error.status === 403)
      return new ActivityMutationError(
        'strava_not_connected',
        'The connected Strava account is unavailable.',
        409,
        false,
        undefined,
        undefined,
        { cause: error },
      );
    if (error.status >= 500)
      return new ActivityMutationError(
        'upstream_unavailable',
        'Strava could not complete the request.',
        503,
        true,
        60,
        undefined,
        { cause: error },
      );
    return new ActivityMutationError(
      'upstream_rejected',
      'Strava rejected the request.',
      502,
      false,
      undefined,
      undefined,
      { cause: error },
    );
  }
  if (
    error instanceof Error &&
    error.message === EXTERNAL_EFFECTS_DISABLED_MESSAGE
  )
    return new ActivityMutationError(
      'external_effects_disabled',
      'Strava access is disabled in this environment.',
      503,
      false,
      undefined,
      undefined,
      { cause: error },
    );
  return new ActivityMutationError(
    'upstream_unavailable',
    'Strava could not complete the request.',
    503,
    true,
    60,
    undefined,
    { cause: error },
  );
}

/**
 * Update an activity in Strava and mirror the result locally. Always
 * resolves the Strava credential and athlete id from the authenticated
 * `Actor` - never from a client-supplied token or athlete id (issue #116) -
 * and rejects the request if the activity is already known to belong to a
 * different athlete (issue #120's ownership-enforcement requirement).
 */
export async function updateActivityForActor(
  actor: Actor,
  input: UpdateActivityInput,
  deps: ActivitiesServiceDeps = {},
): Promise<Activity> {
  const { activitiesRepo, resolveAccount, createClient } = resolveDeps(deps);
  const act = updateActivityInputSchema.parse(input);

  const existing = await requireOwnedActivity(activitiesRepo, actor, act.id);

  const account = await resolveAccount({ userId: actor.userId });
  if (!account?.access_token) {
    throw new ActivityMutationError(
      'strava_not_connected',
      'The connected Strava account is unavailable.',
      409,
    );
  }

  let stravaActivity;
  try {
    const client = createClient(account.access_token);
    const updateData: Omit<UpdatableActivity, 'id' | 'athlete'> = {
      name: act.name,
      sport_type: act.sport_type,
      description: act.description,
      commute: act.commute,
      hide_from_home: act.hide_from_home,
      gear_id: act.gear_id,
    };

    stravaActivity = await client.updateActivity(act.id, updateData);
  } catch (error) {
    logger.error('Failed to update activity:', error);
    if (error instanceof StravaApiError && error.status === 404) {
      try {
        await activitiesRepo.deleteManyForAthlete(actor.athleteId, [act.id]);
      } catch (persistenceError) {
        throw mutationFailure(
          new StravaPersistenceError({ cause: persistenceError }, false),
        );
      }
    }
    throw mutationFailure(error);
  }

  const transformedActivity = {
    ...transformStravaActivity(stravaActivity, true),
    athlete: actor.athleteId,
  } satisfies Activity;

  try {
    const saved = await activitiesRepo.replaceExistingForAthlete(
      actor.athleteId,
      transformedActivity,
      existing.last_updated,
    );
    // A null update means either deletion won the row lock or another
    // committed mutation changed the optimistic fence while Strava was in
    // flight. Reread: missing stays 404; present is the newer authority.
    if (!saved) return await requireOwnedActivity(activitiesRepo, actor, act.id);
    return await requireOwnedActivity(activitiesRepo, actor, act.id);
  } catch (error) {
    if (error instanceof ActivityMutationError) throw error;
    throw mutationFailure(new StravaPersistenceError({ cause: error }));
  }
}

/**
 * Re-fetch a single activity (and its photos) from Strava for the
 * authenticated actor. Rejects up front if the activity is already known to
 * belong to a different athlete.
 */
export async function refreshActivityForActor(
  actor: Actor,
  activityId: number,
  deps: ActivitiesServiceDeps = {},
): Promise<{
  activity: Activity;
  photos: Photo[];
  photosStatus: 'complete' | 'partial';
  photosError: {
    code: ActivityMutationErrorCode;
    retryable: boolean;
    retryAfterSeconds?: number;
  } | null;
}> {
  const { activitiesRepo, photosRepo, resolveAccount, fetchActivities } =
    resolveDeps(deps);

  await requireOwnedActivity(activitiesRepo, actor, activityId);

  const account = await resolveAccount({ userId: actor.userId });
  if (!account?.access_token) {
    throw new ActivityMutationError(
      'strava_not_connected',
      'The connected Strava account is unavailable.',
      409,
    );
  }

  let result: FetchStravaActivitiesResult;
  try {
    result = await fetchActivities({
      accessToken: account.access_token,
      athleteId: actor.athleteId,
      activityIds: [activityId],
      includePhotos: true,
      shouldDeletePhotos: true,
      requireExisting: true,
    });
  } catch (error) {
    logger.error('Failed to refresh activity:', error);
    throw mutationFailure(error);
  }

  if (result.notFoundIds.includes(activityId)) {
    try {
      await activitiesRepo.deleteManyForAthlete(actor.athleteId, [activityId]);
    } catch (error) {
      throw mutationFailure(new StravaPersistenceError({ cause: error }));
    }
    throw new ActivityMutationError(
      'activity_unavailable',
      'The activity is unavailable.',
      404,
    );
  }

  if (!result.activities.some((activity) => activity.id === activityId))
    throw new ActivityMutationError(
      'activity_unavailable',
      'The activity is unavailable.',
      404,
    );

  const activity = await requireOwnedActivity(
    activitiesRepo,
    actor,
    activityId,
  );
  const photosStatus = result.photoRefreshFailedIds?.includes(activityId)
    ? 'partial'
    : 'complete';
  const rawPhotoFailure = result.photoRefreshFailures?.find(
    (failure) => failure.activityId === activityId,
  );
  const classifiedPhotoFailure = rawPhotoFailure
    ? mutationFailure(rawPhotoFailure.error)
    : null;
  const photos =
    photosStatus === 'complete'
      ? await photosRepo.findManyByActivityForAthlete(
          actor.athleteId,
          activityId,
        )
      : [];
  return {
    activity,
    photos,
    photosStatus,
    photosError: classifiedPhotoFailure
      ? {
          code: classifiedPhotoFailure.code,
          retryable: classifiedPhotoFailure.retryable,
          ...(classifiedPhotoFailure.retryAfterSeconds
            ? { retryAfterSeconds: classifiedPhotoFailure.retryAfterSeconds }
            : {}),
        }
      : photosStatus === 'partial'
        ? { code: 'upstream_unavailable', retryable: true }
        : null,
  };
}

/** Delete activities owned by the actor's athlete; ids owned by anyone else are silently ignored. */
export async function deleteActivitiesForActor(
  actor: Actor,
  ids: number[],
  deps: ActivitiesServiceDeps = {},
): Promise<{ deletedCount: number; errors: string[] }> {
  const activityIds = deleteActivitiesSchema.parse(ids);
  if (activityIds.length === 0) {
    return { deletedCount: 0, errors: [] };
  }

  const { activitiesRepo } = resolveDeps(deps);
  const errors: string[] = [];
  let deletedCount = 0;

  try {
    const deletedIds = await activitiesRepo.deleteManyForAthlete(
      actor.athleteId,
      activityIds,
    );
    deletedCount = deletedIds.length;

    if (deletedCount < activityIds.length) {
      const deletedSet = new Set(deletedIds);
      const notDeleted = activityIds.filter((id) => !deletedSet.has(id));
      const errorMsg = `Failed to delete some activities (possible permission issue or already deleted): ${notDeleted.join(', ')}`;
      logger.warn(errorMsg);
      errors.push(errorMsg);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error deleting activities:', errorMsg);
    errors.push(`Server error during deletion: ${errorMsg}`);
  }

  return { deletedCount, errors };
}
