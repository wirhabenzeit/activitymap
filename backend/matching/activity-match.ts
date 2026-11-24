import {
  type ActivityPlacesResponse,
  activityPlacesResponseSchema,
} from '../../src/contracts/activity-places';
import { createBatchActivityPlaceMatcher } from '../../src/server/application/batch-activity-places';
import { LIVE_CATALOGUE } from '../../src/server/places/catalogue-rows';
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
import { matchingTiles, readMatchingTiles } from './tiles';

/**
 * Place matching for recordings held here, for Node actions: the application
 * matcher, coverage and track preparation, reading recordings from file
 * storage and published candidate places by tile for the ingestion worker.
 */

const policy = SERVER_MATCHER_POLICY;

/** What a match reads: a rowset (`dataset`), or the live catalogue at a
 * completed revision (`live`). `metadata` is the stored manifest and
 * coverage, whose snapshot match results name as `catalogueSnapshotId`. */
export type MatchCatalogue = {
  snapshotId: string;
  metadata: Id<'_storage'>;
} & ({ dataset: string; revision: string } | { live: number });

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

/** Whether a rowset (or `LIVE_CATALOGUE`) and the matching recipe in this
 * code are the ones a matching version names. */
export function isMatchingVersion(
  catalogue: { snapshotId: string; revision: string },
  version: string,
) {
  return (
    matchingVersion({
      snapshotId: catalogue.snapshotId,
      revision: catalogue.revision,
    }) === version
  );
}

/** Whether a matching version names the live catalogue under the matching
 * recipe in this code. */
export const isLiveMatchingVersion = (version: string) =>
  isMatchingVersion(LIVE_CATALOGUE, version);

/** The catalogue manifest and coverage stored with a rowset or a live
 * publication. Missing once a newer publication replaced it: the run fails
 * and is retried against the new one. */
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
  // The shared stream contract represents an absent GPS channel as JSON null; the
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

/** Match prepared activities of one owner against one catalogue. Each
 * result names the catalogue tiles its own activity's match read. */
export async function matchPrepared(
  ctx: ActionCtx,
  input: {
    userId: string;
    catalogue: MatchCatalogue;
    published: PublishedCatalogue;
  },
  prepared: PreparedActivity[],
): Promise<
  {
    key: string;
    recording: Id<'recordings'>;
    result: ActivityPlacesResponse;
    tiles: string[];
  }[]
> {
  const windowsOf = prepared.map(({ track }): PlaceQueryWindow[] =>
    track
      ? uniqueQueryWindows(
          placeQueryWindows(track.geometry, policy.discoveryRadiusM),
        )
      : [],
  );
  const scoped = uniqueQueryWindows(windowsOf.flat());
  const { catalogue } = input;
  const read = await readMatchingTiles(
    scoped,
    (tile, cursor) => {
      const paginationOpts = { numItems: 256, cursor };
      return 'dataset' in catalogue
        ? ctx.runQuery(internal.places.tilePage, {
            dataset: catalogue.dataset,
            tile,
            paginationOpts,
          })
        : ctx.runQuery(internal.livePlaces.tilePage, { tile, paginationOpts });
    },
    1,
  );
  const matcher = createBatchActivityPlaceMatcher({
    snapshot: {
      catalogue: input.published,
      revision:
        'dataset' in catalogue ? catalogue.revision : String(catalogue.live),
      places: read.places as CandidatePlace[],
      windows: scoped,
    },
    policy,
  });
  const results = [];
  for (const [index, item] of prepared.entries())
    results.push({
      key: item.key,
      recording: item.recording.id,
      tiles: matchingTiles(windowsOf[index]!),
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
