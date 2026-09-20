import 'server-only';

import { getAccountInternal } from '~/server/db/internal';
import type { Activity, Photo } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import { StravaClient } from '~/server/strava/client';
import { fetchStravaActivities } from '~/server/strava/service';
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
import { photosRepository, type PhotosRepository } from '~/server/repositories/photos';

/**
 * Application service for activity/photo reads, updates, and Strava
 * refreshes (issue #120). This file intentionally has no React, `next/*`,
 * `"use server"`, or Route Handler imports - see
 * `~/server/application/framework-boundary.test.ts`, which enforces that
 * structurally. Route Handlers and Server Actions both call these functions
 * directly, passing an `Actor` they resolved themselves
 * (`~/server/auth/actor.ts`).
 */

export class ForbiddenError extends Error {
  constructor(message = 'Not authorized to access this resource') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

type AccountResolver = typeof getAccountInternal;

export type ActivitiesServiceDeps = {
  activitiesRepo?: ActivitiesRepository;
  photosRepo?: PhotosRepository;
  resolveAccount?: AccountResolver;
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
};

function resolveDeps(deps: ActivitiesServiceDeps) {
  return {
    activitiesRepo: deps.activitiesRepo ?? defaultDeps.activitiesRepo,
    photosRepo: deps.photosRepo ?? defaultDeps.photosRepo,
    resolveAccount: deps.resolveAccount ?? defaultDeps.resolveAccount,
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

async function assertOwnsActivityIfKnown(
  activitiesRepo: ActivitiesRepository,
  actor: Actor,
  activityId: number,
): Promise<void> {
  const [existing] = await activitiesRepo.findManyByIds([activityId]);
  // An activity we don't have locally yet can't have its ownership checked
  // here; Strava's own per-athlete access token scoping is the backstop for
  // that case. An activity we *do* have must belong to this actor.
  if (existing && existing.athlete !== actor.athleteId) {
    throw new ForbiddenError('Activity does not belong to the authenticated athlete');
  }
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
  const { activitiesRepo, resolveAccount } = resolveDeps(deps);
  const act = updateActivityInputSchema.parse(input);

  await assertOwnsActivityIfKnown(activitiesRepo, actor, act.id);

  const account = await resolveAccount({ userId: actor.userId });
  if (!account?.access_token) {
    throw new Error('No Strava access token found');
  }

  const client = StravaClient.withAccessToken(account.access_token);

  try {
    const updateData: Omit<UpdatableActivity, 'id' | 'athlete'> = {
      name: act.name,
      sport_type: act.sport_type,
      description: act.description,
      commute: act.commute,
      hide_from_home: act.hide_from_home,
      gear_id: act.gear_id,
    };

    const stravaActivity = await client.updateActivity(act.id, updateData);

    const transformedActivity = {
      ...transformStravaActivity(stravaActivity, true),
      athlete: actor.athleteId,
    } satisfies Activity;

    return await activitiesRepo.upsertOne(transformedActivity);
  } catch (error) {
    logger.error('Failed to update activity:', error);
    throw new Error('Failed to update activity');
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
) {
  const { activitiesRepo, resolveAccount } = resolveDeps(deps);

  await assertOwnsActivityIfKnown(activitiesRepo, actor, activityId);

  const account = await resolveAccount({ userId: actor.userId });
  if (!account?.access_token) {
    throw new Error('No Strava access token found');
  }

  return fetchStravaActivities({
    accessToken: account.access_token,
    athleteId: actor.athleteId,
    activityIds: [activityId],
    includePhotos: true,
  });
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
