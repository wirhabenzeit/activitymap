import 'server-only';

import type { SportType } from '~/contracts/sport';
import type {
  MergeActivitiesRequest,
  MergeFileRequest,
  MergeUploadState,
  MergedActivityMetadata,
} from '~/contracts/v1/activity-merge';
import {
  type MergeCandidate,
  describeMergeBlocker,
  planMerge,
} from '~/lib/activity-merge/eligibility';
import {
  MissingMergeSamplesError,
  combineRecordings,
} from '~/server/activity-merge/combine';
import { encodeMergedFit } from '~/server/activity-merge/fit';
import type { MergeStreams } from '~/server/activity-merge/streams';
import type { Actor } from '~/server/auth/actor';
import { getAccountInternal } from '~/server/auth/users';
import { logger } from '~/server/logging/logger';
import { StravaClient, type StravaUpload } from '~/server/strava/client';
import { StravaPersistenceError } from '~/server/strava/service';
import type { StravaActivity } from '~/server/strava/types';
import {
  type ConvexActivityCommands,
  convexActivityCommands,
} from '~/server/sync/convex-commands';

import {
  ActivityMutationError,
  mutationFailure,
  resolveConnectedAccount,
} from './activities';

/**
 * Merge consecutive activities: rebuild one recording from the parts'
 * streams, encode it as FIT, upload it to Strava as a new activity and
 * apply the chosen name, sport and settings once Strava created it.
 *
 * Nothing is deleted. Strava's API cannot delete activities, so the
 * originals stay until the athlete deletes them on Strava; the webhook then
 * removes them from the library like any other deletion. The new activity
 * arrives through the same webhook path as any upload.
 */

type MergeClient = Pick<
  StravaClient,
  | 'getActivity'
  | 'getActivities'
  | 'getActivityStreamsForMerge'
  | 'createUpload'
  | 'getUpload'
  | 'updateActivity'
>;

export type ActivityMergeDeps = {
  resolveAccount?: typeof getAccountInternal;
  createClient?: (accessToken: string) => MergeClient;
  commands?: (actor: Actor) => Pick<ConvexActivityCommands, 'known'>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** How long one request waits for Strava to process an upload. */
  processingWaitMs?: number;
};

const POLL_INTERVAL_MS = 1500;
const DEFAULT_PROCESSING_WAIT_MS = 30_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function connectedClient(actor: Actor, deps: ActivityMergeDeps) {
  const account = await resolveConnectedAccount(
    actor,
    deps.resolveAccount ?? getAccountInternal,
  );
  return (
    deps.createClient ??
    ((token: string) => StravaClient.withAccessToken(token))
  )(account.access_token);
}

function candidate(activity: StravaActivity): MergeCandidate & {
  description: string | null;
} {
  return {
    id: String(activity.id),
    name: activity.name,
    description: activity.description ?? null,
    sport_type: activity.sport_type,
    start_date: new Date(activity.start_date),
    elapsed_time: activity.elapsed_time,
    manual: activity.manual,
    trainer: activity.trainer,
    private: activity.private,
    map_summary_polyline: activity.map?.summary_polyline ?? null,
    start_latlng: activity.start_latlng,
    end_latlng: activity.end_latlng,
    kudos_count: activity.kudos_count,
    comment_count: activity.comment_count,
    total_photo_count: activity.total_photo_count,
  };
}

/** Seconds east of UTC, from Strava's local and UTC start. */
function utcOffsetSeconds(activity: StravaActivity): number {
  const local = Date.parse(activity.start_date_local);
  const utc = Date.parse(activity.start_date);
  return Number.isFinite(local) && Number.isFinite(utc)
    ? Math.round((local - utc) / 1000)
    : 0;
}

export type MergedFile = {
  bytes: Uint8Array;
  fileName: string;
  sources: StravaActivity[];
  sport: SportType;
  trainer: boolean;
};

/**
 * Read the parts from Strava, recheck that they can be merged and build
 * the merged FIT file. Every part must be in the athlete's library.
 */
export async function buildMergedFile(
  actor: Actor,
  request: MergeFileRequest,
  deps: ActivityMergeDeps = {},
): Promise<MergedFile> {
  const commands = (deps.commands ?? convexActivityCommands)(actor);
  for (const id of request.activity_ids) {
    let known;
    try {
      known = await commands.known(id);
    } catch (error) {
      throw mutationFailure(
        new StravaPersistenceError({ cause: error }, false),
      );
    }
    if (!known)
      throw new ActivityMutationError(
        'activity_unavailable',
        'An activity to merge is not in the library.',
        404,
        false,
        undefined,
        { activityId: id },
      );
  }

  const client = await connectedClient(actor, deps);
  let sources: StravaActivity[];
  let neighbours: StravaActivity[];
  try {
    sources = [];
    for (const id of request.activity_ids)
      sources.push(await client.getActivity(id));
    const starts = sources.map((source) => Date.parse(source.start_date));
    const ends = sources.map(
      (source) => Date.parse(source.start_date) + source.elapsed_time * 1000,
    );
    neighbours = await client.getActivities({
      after: Math.floor(Math.min(...starts) / 1000) - 1,
      before: Math.ceil(Math.max(...ends) / 1000) + 1,
      per_page: 50,
    });
  } catch (error) {
    throw mutationFailure(error);
  }

  const plan = planMerge(sources.map(candidate), neighbours.map(candidate));
  if (plan.blockers.length > 0) {
    const names = new Map(
      sources.map((source) => [String(source.id), source.name]),
    );
    throw new ActivityMutationError(
      'merge_not_allowed',
      describeMergeBlocker(plan.blockers[0]!, (id) => names.get(id) ?? id),
      422,
      false,
      undefined,
      { blockers: plan.blockers },
    );
  }
  const ordered = plan.parts.map((part) =>
    sources.find((source) => String(source.id) === part.id)!,
  );

  let recording;
  try {
    const streams: MergeStreams[] = [];
    for (const source of ordered)
      streams.push(await client.getActivityStreamsForMerge(String(source.id)));
    recording = combineRecordings(
      ordered.map((source, index) => ({
        id: String(source.id),
        startDate: new Date(source.start_date),
        elapsedTime: source.elapsed_time,
        movingTime: source.moving_time,
        distance: source.distance,
        totalElevationGain: source.total_elevation_gain,
        streams: streams[index]!,
      })),
    );
  } catch (error) {
    if (error instanceof MissingMergeSamplesError)
      throw new ActivityMutationError(
        'merge_not_allowed',
        'An activity has no usable recorded data to merge.',
        422,
        false,
        undefined,
        { activityId: error.sourceId },
      );
    throw mutationFailure(error);
  }

  const sport = request.sport_type ?? plan.sport;
  const trainer = ordered.every((source) => source.trainer);
  const bytes = encodeMergedFit(recording, {
    sport,
    trainer,
    utcOffsetSeconds: utcOffsetSeconds(ordered[0]!),
    now: (deps.now ?? (() => new Date()))(),
  });
  const day = ordered[0]!.start_date_local.slice(0, 10);
  return {
    bytes,
    fileName: `merged-${day}-${ordered.map((source) => source.id).join('-')}.fit`,
    sources: ordered,
    sport,
    trainer,
  };
}

/** The activity Strava says an upload duplicates, if that is the failure. */
export function duplicateOf(error: string | null): string | null {
  if (!error || !/duplicate/i.test(error)) return null;
  return (
    /activities\/(\d+)/.exec(error)?.[1] ?? /(\d{6,})/.exec(error)?.[1] ?? null
  );
}

function stateOf(
  upload: StravaUpload,
  uploadId: string,
  metadataApplied: boolean,
): MergeUploadState {
  const status = upload.activityId
    ? 'ready'
    : upload.error
      ? 'failed'
      : 'processing';
  return {
    upload_id: uploadId,
    status,
    activity_id: upload.activityId,
    error: upload.error,
    duplicate_of: duplicateOf(upload.error),
    metadata_applied: metadataApplied,
  };
}

/** Poll until the upload is processed or the wait runs out, then apply the
 * metadata once the activity exists. */
async function settle(
  client: MergeClient,
  initial: StravaUpload,
  uploadId: string,
  metadata: MergedActivityMetadata,
  deps: ActivityMergeDeps,
): Promise<MergeUploadState> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = () => (deps.now ?? (() => new Date()))().getTime();
  const deadline =
    now() + (deps.processingWaitMs ?? DEFAULT_PROCESSING_WAIT_MS);
  let upload = initial;
  while (!upload.activityId && !upload.error && now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      upload = await client.getUpload(uploadId);
    } catch (error) {
      throw mutationFailure(error);
    }
  }
  if (!upload.activityId) return stateOf(upload, uploadId, false);

  let applied = false;
  try {
    await client.updateActivity(Number(upload.activityId), {
      name: metadata.name,
      description: metadata.description,
      sport_type: metadata.sport_type,
      ...(metadata.commute !== undefined && { commute: metadata.commute }),
      ...(metadata.hide_from_home !== undefined && {
        hide_from_home: metadata.hide_from_home,
      }),
      ...(metadata.gear_id ? { gear_id: metadata.gear_id } : {}),
    });
    applied = true;
  } catch (error) {
    // The activity exists either way; the athlete can edit it on Strava.
    logger.warn('Merged activity created, but its settings were not applied', {
      uploadId,
      error,
    });
  }
  return stateOf(upload, uploadId, applied);
}

export async function mergeActivities(
  actor: Actor,
  request: MergeActivitiesRequest,
  deps: ActivityMergeDeps = {},
): Promise<MergeUploadState> {
  const file = await buildMergedFile(
    actor,
    { activity_ids: request.activity_ids, sport_type: request.sport_type },
    deps,
  );
  const client = await connectedClient(actor, deps);
  const metadata: MergedActivityMetadata = {
    name: request.name,
    description: request.description,
    sport_type: request.sport_type,
    commute: request.commute,
    hide_from_home: request.hide_from_home,
    gear_id: request.gear_id,
  };
  let upload: StravaUpload;
  try {
    upload = await client.createUpload({
      file: file.bytes,
      fileName: file.fileName,
      dataType: 'fit',
      name: metadata.name,
      description: metadata.description,
      trainer: file.trainer,
      ...(metadata.commute !== undefined && { commute: metadata.commute }),
      externalId: `activitymap-merge-${file.sources.map((source) => source.id).join('-')}-${(deps.now ?? (() => new Date()))().getTime()}`,
    });
  } catch (error) {
    throw mutationFailure(error);
  }
  if (!upload.id)
    throw new ActivityMutationError(
      'upstream_unavailable',
      'Strava did not accept the upload.',
      503,
      true,
      60,
    );
  logger.info('Merged activity uploaded', {
    uploadId: upload.id,
    parts: file.sources.length,
  });
  return settle(client, upload, upload.id, metadata, deps);
}

/** Continue an upload that was still processing. */
export async function continueMergeUpload(
  actor: Actor,
  uploadId: string,
  metadata: MergedActivityMetadata,
  deps: ActivityMergeDeps = {},
): Promise<MergeUploadState> {
  const client = await connectedClient(actor, deps);
  let upload: StravaUpload;
  try {
    upload = await client.getUpload(uploadId);
  } catch (error) {
    throw mutationFailure(error);
  }
  return settle(client, upload, uploadId, metadata, {
    ...deps,
    processingWaitMs: deps.processingWaitMs ?? 15_000,
  });
}
