import { createHash } from 'node:crypto';

import type { ActivityPlacesResponse } from '~/contracts/activity-places';
import type { ActivityDTO } from '~/contracts/v1/activity';
import type { RawActivityStreams } from '~/server/strava/streams';
import type { ConvexWriter } from '~/server/sync/convex-writer';

import { encodeRecording } from './recording';

/**
 * Shadow writes: copy an owner's Postgres state into the Convex application
 * backend while Postgres stays the writer.
 *
 * Postgres records every visible activity, stream and match change in
 * `sync_change`. A run reads the activities touched since its checkpoint,
 * re-reads their *current* state and writes it through the fenced batch
 * functions in `backend/convex/importer.ts`, labelled with a run revision that
 * only ever increases. Because each run sends current state rather than
 * individual events, out-of-order or repeated changes cannot regress Convex.
 *
 * Some writers (the stream trigger) add `sync_change` rows without the
 * per-athlete lock, so a lower sequence can commit after a higher one was
 * read. Each run therefore also replays changes from a recent time window;
 * replays of unchanged state are no-ops and publish nothing.
 */

export type MirrorActivity = Omit<ActivityDTO, 'streams' | 'placeMatches'>;
export type MirrorRecordingIdentity = {
  id: string;
  generation: string;
  revision: string;
};
export type MirrorRecording = MirrorRecordingIdentity & {
  fetchedAt: string | null;
  payload: RawActivityStreams;
};

/** Read side of the mirror, implemented for Postgres and for tests. */
export type MirrorSource = {
  /** Highest change sequence currently visible for the owner. */
  latestSequence(): Promise<number>;
  /** Activities with a change after `afterSequence` or since `since`, each
   * with its latest sequence, ordered by that sequence. */
  changedActivities(
    afterSequence: number,
    since: Date,
    limit: number,
  ): Promise<{ id: string; sequence: number }[]>;
  /** The owner's activity IDs after `afterId`, ascending (full mode). */
  activityIds(afterId: string | null, limit: number): Promise<string[]>;
  /** Current metadata of the owner's activities among `ids`. Missing IDs
   * no longer exist. */
  activities(ids: string[]): Promise<MirrorActivity[]>;
  /** Identities of the current stored recordings among `ids`. */
  recordings(ids: string[]): Promise<MirrorRecordingIdentity[]>;
  /** Payloads of the current stored recordings among `ids`. */
  payloads(ids: string[]): Promise<MirrorRecording[]>;
  /** The matching version and every result among `ids`. */
  matches(
    ids: string[],
  ): Promise<{ version: string; results: ActivityPlacesResponse[] }>;
};

type OwnerState = {
  backend: 'postgres' | 'convex';
  epoch: string;
  generation: string;
  revoked: boolean;
  catalogue: string;
  matchingVersion: string;
  mirror: { sequence: number; revision: number } | null;
};

export type MirrorResult = {
  mode: 'full' | 'incremental';
  activities: number;
  applied: number;
  deleted: number;
  recordings: number;
  matches: number;
  catalogueSelected: boolean;
  /** False when the run stopped early (deadline, limit or catalogue change);
   * the next run continues from the checkpoint. */
  complete: boolean;
  checkpoint: { sequence: number; revision: number };
};

const CHUNK = 256;
const BATCH_BYTES = 512 * 1024;
const BATCH_ITEMS = 64;
const RECORDING_BATCH = 16;
const FINISHED = new Set(['complete', 'partial', 'uncovered']);

/** Convex catalogue identity for a Postgres matching version. It changes
 * exactly when the Postgres catalogue or matching recipe changes. */
export function catalogueFor(matchingVersion: string) {
  return createHash('sha256')
    .update(JSON.stringify({ postgresMatchingVersion: matchingVersion }))
    .digest('hex');
}

function batches<T>(items: T[]) {
  const result: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (
      current.length > 0 &&
      (bytes + size > BATCH_BYTES || current.length >= BATCH_ITEMS)
    ) {
      result.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) result.push(current);
  return result;
}

export async function mirrorOwner({
  source,
  writer,
  upload,
  full = false,
  now = () => Date.now(),
  overlapMs = 15 * 60_000,
  maxActivities = 2_000,
  deadline = Number.POSITIVE_INFINITY,
  log = () => undefined,
}: {
  source: MirrorSource;
  writer: ConvexWriter;
  /** POST a recording file to a Convex upload URL; returns its storage ID. */
  upload: (url: string, file: Uint8Array) => Promise<string>;
  full?: boolean;
  now?: () => number;
  overlapMs?: number;
  maxActivities?: number;
  /** Epoch milliseconds after which no new chunk starts. */
  deadline?: number;
  log?: (message: string) => void;
}): Promise<MirrorResult> {
  const state = await writer.write<OwnerState | null>({ kind: 'state' });
  if (!state) throw new Error('The owner is not provisioned in Convex');
  if (state.revoked || state.backend !== 'convex')
    throw new Error('The Convex owner is not assigned to Convex');
  const epoch = state.epoch;
  const write = <T>(operation: { kind: string; [field: string]: unknown }) =>
    writer.write<T>(operation, epoch);
  const revision = Math.max(now(), (state.mirror?.revision ?? 0) + 1);
  const common = { generation: state.generation, sourceRevision: revision };
  const result: MirrorResult = {
    mode: full ? 'full' : 'incremental',
    activities: 0,
    applied: 0,
    deleted: 0,
    recordings: 0,
    matches: 0,
    catalogueSelected: false,
    complete: true,
    checkpoint: { sequence: state.mirror?.sequence ?? 0, revision },
  };

  // Which activities to copy, in the order their checkpoint can advance.
  let chunks: { ids: string[]; through: number | null }[];
  let fullThrough = 0;
  if (full) {
    // Everything visible at this sequence is copied; later changes are newer.
    fullThrough = await source.latestSequence();
    const ids: string[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await source.activityIds(after, 1_000);
      ids.push(...page);
      if (page.length < 1_000) break;
      after = page.at(-1)!;
    }
    chunks = [];
    for (let i = 0; i < ids.length; i += CHUNK)
      chunks.push({ ids: ids.slice(i, i + CHUNK), through: null });
  } else {
    const changed = await source.changedActivities(
      result.checkpoint.sequence,
      new Date(now() - overlapMs),
      maxActivities + 1,
    );
    if (changed.length > maxActivities) {
      changed.length = maxActivities;
      result.complete = false;
    }
    chunks = [];
    for (let i = 0; i < changed.length; i += CHUNK) {
      const slice = changed.slice(i, i + CHUNK);
      // Sorted by latest sequence: every later activity's latest change is
      // above this chunk's, so the checkpoint can safely move to it.
      chunks.push({
        ids: slice.map((item) => item.id),
        through: Math.max(...slice.map((item) => item.sequence)),
      });
    }
  }

  const advance = async (sequence: number) => {
    result.checkpoint = {
      sequence: Math.max(result.checkpoint.sequence, sequence),
      revision,
    };
    await write({ kind: 'checkpoint', ...result.checkpoint });
  };

  // Select the Postgres catalogue first, so matches publish under it.
  let catalogue = state.catalogue;
  let matchingVersion = state.matchingVersion;
  const firstId = chunks[0]?.ids[0];
  if (firstId) {
    const { version } = await source.matches([firstId]);
    if (version !== matchingVersion) {
      catalogue = catalogueFor(version);
      matchingVersion = version;
      await write({ kind: 'selectCatalogue', catalogue, matchingVersion });
      result.catalogueSelected = true;
      log(`Selected catalogue for matching version ${version}`);
    }
  }

  for (const chunk of chunks) {
    if (now() > deadline) {
      result.complete = false;
      break;
    }
    result.activities += chunk.ids.length;
    const activities = await source.activities(chunk.ids);
    const present = new Set(activities.map((activity) => activity.id));
    const gone = chunk.ids.filter((id) => !present.has(id));
    for (const ids of batches(gone))
      result.deleted += await write<number>({
        kind: 'deleteSources',
        ...common,
        ids,
      });

    const identities = new Map(
      (await source.recordings([...present])).map((item) => [item.id, item]),
    );
    const needsRecording = new Set<string>();
    const needsMatch = new Set<string>();
    for (const items of batches(activities)) {
      const applied = await write<{
        applied: number;
        needsRecording: string[];
        needsMatch: string[];
      }>({
        kind: 'applySources',
        ...common,
        items,
        recordings: items.flatMap((item) => identities.get(item.id) ?? []),
      });
      result.applied += applied.applied;
      applied.needsRecording.forEach((id) => needsRecording.add(id));
      applied.needsMatch.forEach((id) => needsMatch.add(id));
    }

    const recordings = needsRecording.size
      ? await source.payloads([...needsRecording])
      : [];
    for (let i = 0; i < recordings.length; i += RECORDING_BATCH) {
      const slice = recordings.slice(i, i + RECORDING_BATCH);
      const urls = await write<string[]>({
        kind: 'uploadUrls',
        count: slice.length,
      });
      const items = await Promise.all(
        slice.map(async (recording, index) => {
          const { file, manifest } = encodeRecording(recording.payload);
          return {
            id: recording.id,
            file: await upload(urls[index]!, file),
            manifest,
            recordingGeneration: recording.generation,
            recordingRevision: recording.revision,
            ...(recording.fetchedAt && { fetchedAt: recording.fetchedAt }),
          };
        }),
      );
      result.recordings += await write<number>({
        kind: 'prepareRecordings',
        ...common,
        items,
      });
    }

    if (needsMatch.size) {
      const { version, results } = await source.matches([...needsMatch]);
      if (version !== matchingVersion) {
        // The catalogue changed mid-run: stop before this chunk's checkpoint
        // so the next run selects the new catalogue and replays it.
        log('The Postgres catalogue changed during the run; stopping early');
        result.complete = false;
        break;
      }
      const finished = results.filter((item) => FINISHED.has(item.status));
      for (const items of batches(finished))
        result.matches += await write<number>({
          kind: 'publishMatches',
          ...common,
          catalogue,
          items,
        });
    }
    if (chunk.through !== null) await advance(chunk.through);
    log(JSON.stringify({ ...result, checkpoint: undefined }));
  }
  if (full && result.complete) await advance(fullThrough);
  else if (!full && chunks.length === 0) await advance(0);
  return result;
}
