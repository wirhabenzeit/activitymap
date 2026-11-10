import {
  type ActivityPlacesResponse,
  activityPlacesResponseSchema,
} from '../../src/contracts/activity-places';
import { createBatchActivityPlaceMatcher } from '../../src/server/application/batch-activity-places';
import {
  SERVER_MATCHER_POLICY,
  matchingVersion,
} from '../../src/server/places/matching-version';
import type { PublishedCatalogue } from '../../src/server/places/published-catalogue-core';
import {
  type PlaceQueryWindow,
  placeQueryWindows,
  uniqueQueryWindows,
} from '../../src/server/places/query-windows';
import type { CandidatePlace } from '../../src/server/places/run-types';
import {
  type PreparedTrack,
  prepareTrack,
} from '../../src/server/places/track-sections';
import { internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { ActionCtx } from '../convex/_generated/server';
import { MAX_RECORDING_BYTES, decodeWhole } from '../recording/codec';
import { readMatchingTiles } from './tiles';

/**
 * Place matching for recordings held here, for Node actions: the application
 * matcher, coverage and track preparation the Postgres worker uses, reading
 * recordings from file storage and candidate places from the copied
 * catalogue by tile. The shadow matcher and the ingestion worker both use it.
 */

const policy = SERVER_MATCHER_POLICY;

export type MatchCatalogue = {
  dataset: string;
  snapshotId: string;
  revision: string;
  metadata: Id<'_storage'>;
};

export type MatchRecording = {
  id: Id<'recordings'>;
  file: Id<'_storage'>;
  manifest: Parameters<typeof decodeWhole>[1];
  generation: string;
  revision: string;
};

export type PreparedActivity = {
  key: string;
  id: string;
  recording: Pick<MatchRecording, 'id' | 'generation' | 'revision'>;
  track: PreparedTrack | undefined;
  tooLarge: boolean;
};

/** Whether a rowset and the matching recipe in this code are the ones a
 * matching version names. */
export function isMatchingVersion(
  catalogue: Pick<MatchCatalogue, 'snapshotId' | 'revision'>,
  version: string,
) {
  return (
    matchingVersion({
      snapshotId: catalogue.snapshotId,
      revision: catalogue.revision,
    }) === version
  );
}

/** The catalogue manifest and coverage stored with a rowset. */
export async function readCatalogue(
  ctx: ActionCtx,
  catalogue: MatchCatalogue,
): Promise<PublishedCatalogue> {
  const metadata = await ctx.storage.get(catalogue.metadata);
  if (!metadata) throw new Error('Catalogue metadata missing');
  return JSON.parse(await metadata.text()) as PublishedCatalogue;
}

/** Read one recording and prepare its track for matching. */
export async function prepareActivity(
  ctx: ActionCtx,
  item: { key: string; id: string; recording: MatchRecording },
): Promise<PreparedActivity> {
  const { recording } = item;
  const file = await ctx.storage.get(recording.file);
  if (!file || file.size > MAX_RECORDING_BYTES)
    throw new Error('Recording file unavailable or too large');
  const streams = decodeWhole(
    new Uint8Array(await file.arrayBuffer()),
    recording.manifest,
  );
  const tooLarge = (streams.latlng?.data.length ?? 0) > policy.maxSamples;
  // The Postgres worker projects an absent GPS channel as JSON null, and the
  // matcher's answer depends on it.
  const payload = streams.latlng ? streams : { ...streams, latlng: null };
  return {
    key: item.key,
    id: item.id,
    recording,
    tooLarge,
    track: tooLarge
      ? undefined
      : prepareTrack(payload as Parameters<typeof prepareTrack>[0], policy),
  };
}

/** Match prepared activities of one owner against one rowset. */
export async function matchPrepared(
  ctx: ActionCtx,
  input: {
    userId: string;
    catalogue: MatchCatalogue;
    published: PublishedCatalogue;
  },
  prepared: PreparedActivity[],
): Promise<
  { key: string; recording: Id<'recordings'>; result: ActivityPlacesResponse }[]
> {
  const windows: PlaceQueryWindow[] = [];
  for (const { track } of prepared)
    if (track)
      windows.push(
        ...placeQueryWindows(track.geometry, policy.discoveryRadiusM),
      );
  const scoped = uniqueQueryWindows(windows);
  const read = await readMatchingTiles(
    scoped,
    (tile, cursor) =>
      ctx.runQuery(internal.places.tilePage, {
        dataset: input.catalogue.dataset,
        tile,
        paginationOpts: { numItems: 256, cursor },
      }),
    1,
  );
  const matcher = createBatchActivityPlaceMatcher({
    snapshot: {
      catalogue: input.published,
      revision: input.catalogue.revision,
      places: read.places as CandidatePlace[],
      windows: scoped,
    },
    policy,
  });
  const results = [];
  for (const item of prepared)
    results.push({
      key: item.key,
      recording: item.recording.id,
      result: activityPlacesResponseSchema.parse(
        await matcher.match(
          {
            userId: input.userId,
            activityId: item.id,
            input: {
              payload: null,
              generation: item.recording.generation,
              revision: item.recording.revision,
              too_large: item.tooLarge,
            },
          },
          item.track,
        ),
      ),
    });
  return results;
}
