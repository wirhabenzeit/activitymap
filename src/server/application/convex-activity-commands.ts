import 'server-only';

import { type ActivityDTO, toActivityDTO } from '~/contracts/v1/activity';
import { type PhotoDTO, toPhotoDTO } from '~/contracts/v1/photo';
import type { Actor } from '~/server/auth/actor';
import { getAccountInternal } from '~/server/auth/users';
import { logger } from '~/server/logging/logger';
import type { Activity } from '~/server/records';
import {
  StravaClient,
  isStravaActivityNotFoundError,
} from '~/server/strava/client';
import {
  type FetchStravaActivitiesResult,
  StravaPersistenceError,
  fetchStravaActivities,
} from '~/server/strava/service';
import { transformStravaActivity } from '~/server/strava/transforms';
import {
  type UpdateActivityInput,
  updateActivityInputSchema,
} from '~/server/strava/validators';
import {
  type ConvexActivityCommands,
  convexActivityCommands,
} from '~/server/sync/convex-commands';

import {
  ActivityMutationError,
  type ActivityMutationErrorCode,
  mutationFailure,
  resolveConnectedAccount,
} from './activities';

/**
 * Edit and refresh for an account whose library Convex writes
 * (docs/convex-writer-cutover.md, step 8). The app still makes the Strava
 * call, with the account's own credential and the shared request budget,
 * exactly as for a Postgres-written account. What differs is where the
 * result goes: one signed write to Convex (`ingestion.apply`), and the
 * response is what Convex then serves. Nothing is read from or written to
 * the account's activities in Postgres.
 */

export type ConvexActivityCommandDeps = {
  resolveAccount?: typeof getAccountInternal;
  createClient?: (accessToken: string) => Pick<StravaClient, 'updateActivity'>;
  fetchActivities?: (
    input: Parameters<typeof fetchStravaActivities>[0],
  ) => Promise<FetchStravaActivitiesResult>;
  commands?: (actor: Actor) => ConvexActivityCommands;
};

const unavailable = () =>
  new ActivityMutationError(
    'activity_unavailable',
    'The activity is unavailable.',
    404,
  );

function source(activity: Activity) {
  // Streams and matches are derived state that Convex publishes itself.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { streams, placeMatches, ...dto } = toActivityDTO(activity);
  return dto;
}

/** Commands act on activities in the library; checked before anything is
 * changed at the provider. */
async function requireKnown(commands: ConvexActivityCommands, id: string) {
  let known;
  try {
    known = await commands.known(id);
  } catch (error) {
    throw mutationFailure(new StravaPersistenceError({ cause: error }, false));
  }
  if (!known) throw unavailable();
}

/** The provider says the activity is gone: record that, then report it. */
async function removed(commands: ConvexActivityCommands, id: string) {
  try {
    await commands.apply({ id, dto: null });
  } catch (error) {
    throw mutationFailure(new StravaPersistenceError({ cause: error }, false));
  }
}

export async function updateActivityThroughConvex(
  actor: Actor,
  input: UpdateActivityInput,
  deps: ConvexActivityCommandDeps = {},
): Promise<ActivityDTO> {
  const act = updateActivityInputSchema.parse(input);
  const id = String(act.id);
  const commands = (deps.commands ?? convexActivityCommands)(actor);
  await requireKnown(commands, id);
  const account = await resolveConnectedAccount(
    actor,
    deps.resolveAccount ?? getAccountInternal,
  );

  let stravaActivity;
  try {
    const client = (
      deps.createClient ??
      ((token: string) => StravaClient.withAccessToken(token))
    )(account.access_token);
    stravaActivity = await client.updateActivity(act.id, {
      name: act.name,
      sport_type: act.sport_type,
      description: act.description,
      commute: act.commute,
      hide_from_home: act.hide_from_home,
      gear_id: act.gear_id,
    });
  } catch (error) {
    logger.error('Failed to update activity:', error);
    if (isStravaActivityNotFoundError(error)) await removed(commands, id);
    throw mutationFailure(error);
  }

  let applied;
  try {
    applied = await commands.apply({
      id,
      dto: source({
        ...transformStravaActivity(stravaActivity, true),
        athlete: actor.athleteId,
      }),
    });
  } catch (error) {
    throw mutationFailure(new StravaPersistenceError({ cause: error }));
  }
  // Strava accepted the edit, but the activity left the library meanwhile.
  if (!applied?.activity)
    throw new ActivityMutationError(
      'local_state_conflict',
      'Strava accepted the edit, but the activity is no longer in the library.',
      409,
      false,
      undefined,
      { upstreamSucceeded: true, recovery: 'refresh_before_retry' },
    );
  return applied.activity;
}

export async function refreshActivityThroughConvex(
  actor: Actor,
  activityId: number,
  deps: ConvexActivityCommandDeps = {},
): Promise<{
  activity: ActivityDTO;
  photos: PhotoDTO[];
  photosStatus: 'complete' | 'partial';
  photosError: {
    code: ActivityMutationErrorCode;
    retryable: boolean;
    retryAfterSeconds?: number;
  } | null;
}> {
  const id = String(activityId);
  const commands = (deps.commands ?? convexActivityCommands)(actor);
  await requireKnown(commands, id);
  const account = await resolveConnectedAccount(
    actor,
    deps.resolveAccount ?? getAccountInternal,
  );

  let result: FetchStravaActivitiesResult;
  try {
    result = await (deps.fetchActivities ?? fetchStravaActivities)({
      accessToken: account.access_token,
      athleteId: actor.athleteId,
      activityIds: [activityId],
      includePhotos: true,
      shouldDeletePhotos: true,
      // The result goes to Convex below, not to Postgres.
      persist: false,
    });
  } catch (error) {
    logger.error('Failed to refresh activity:', error);
    throw mutationFailure(error);
  }

  if (result.notFoundIds.includes(activityId)) {
    await removed(commands, id);
    throw unavailable();
  }
  if (result.failedIds?.includes(activityId))
    throw mutationFailure(
      result.failures?.find((failure) => failure.activityId === activityId)
        ?.error ??
        new ActivityMutationError(
          'upstream_unavailable',
          'Strava could not complete the request.',
          503,
          true,
          60,
        ),
    );
  const activity = result.activities.find((item) => item.id === activityId);
  if (!activity) throw unavailable();

  const complete =
    !!result.photoRefreshAuthoritativeIds?.includes(activityId) &&
    !result.photoRefreshFailedIds?.includes(activityId);
  let applied;
  try {
    applied = await commands.apply({
      id,
      dto: source(activity),
      // A photo set that was not read in full leaves the stored one alone.
      ...(complete && {
        photos: result.photos
          .filter((photo) => photo.activity_id === activityId)
          .map(toPhotoDTO),
      }),
    });
  } catch (error) {
    throw mutationFailure(new StravaPersistenceError({ cause: error }));
  }
  if (!applied?.activity) throw unavailable();

  const rawPhotoFailure = result.photoRefreshFailures?.find(
    (failure) => failure.activityId === activityId,
  );
  const photoFailure = rawPhotoFailure
    ? mutationFailure(rawPhotoFailure.error)
    : null;
  return {
    activity: applied.activity,
    photos: complete ? applied.photos : [],
    photosStatus: complete ? 'complete' : 'partial',
    photosError: photoFailure
      ? {
          code: photoFailure.code,
          retryable: photoFailure.retryable,
          ...(photoFailure.retryAfterSeconds
            ? { retryAfterSeconds: photoFailure.retryAfterSeconds }
            : {}),
        }
      : complete
        ? null
        : { code: 'upstream_unavailable', retryable: true },
  };
}
