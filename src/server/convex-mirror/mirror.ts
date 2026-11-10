import { createHash } from 'node:crypto';

import type { ActivityPlacesResponse } from '~/contracts/activity-places';
import type { ActivityDTO } from '~/contracts/v1/activity';
import type { PhotoDTO } from '~/contracts/v1/photo';
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
 * Photos travel as the current photo set of each copied activity. A photo
 * change on its own (`sync_change` rows of type `photo`) copies the set of the
 * photo's activity, or deletes the photo in Convex when Postgres no longer
 * has it. Photo changes keep their own position (`photoSequence`). Libraries copied before photos were mirrored are caught up by a
 * resumable pass over all activities (`MirrorPosition.photos`).
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
  /** Photos with a change after `afterSequence` or since `since`, each with
   * its latest sequence, ordered by that sequence. */
  changedPhotos(
    afterSequence: number,
    since: Date,
    limit: number,
  ): Promise<{ id: string; sequence: number }[]>;
  /** The activity of each of the owner's photos among `ids`. Missing IDs no
   * longer exist. */
  photoActivities(ids: string[]): Promise<{ id: string; activityId: string }[]>;
  /** The current photos of the owner's activities among `activityIds`. */
  photos(activityIds: string[]): Promise<PhotoDTO[]>;
};

type OwnerState = {
  backend: 'postgres' | 'convex';
  /** Who writes the owner's library in Convex. */
  writer?: 'postgres' | 'handoff' | 'convex';
  epoch: string;
  generation: string;
  revoked: boolean;
  catalogue: string;
  matchingVersion: string;
  mirror: MirrorPosition | null;
};

/** A run's position. `full` is an unfinished full copy: the last copied
 * activity ID and the change sequence the copy started from. */
export type MirrorPosition = {
  sequence: number;
  revision: number;
  full?: { after: string; through: number };
  /** Photo catch-up for a library copied before photos were mirrored: the
   * last activity ID whose photos were copied, or null when it is finished.
   * Absent means it has not started. */
  photos?: string | null;
  /** The last mirrored photo change sequence. Absent until the first run
   * that mirrors photos, which starts from `sequence`. */
  photoSequence?: number;
};

export type MirrorResult = {
  mode: 'full' | 'incremental';
  activities: number;
  applied: number;
  deleted: number;
  recordings: number;
  matches: number;
  /** Photo documents added, changed or removed. */
  photos: number;
  /** Activities whose photo set Convex rejected in this run. */
  photoErrors: number;
  catalogueSelected: boolean;
  /** False when the run stopped early (deadline, limit or catalogue change);
   * the next run continues from the checkpoint. */
  complete: boolean;
  checkpoint: MirrorPosition;
};

const CHUNK = 256;
// Full copies upload a recording for nearly every activity; smaller chunks
// keep each checkpoint within one cron run's time budget.
const FULL_CHUNK = 64;
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

/**
 * One mirror run. Without a checkpoint (a newly provisioned owner) or with an
 * unfinished full copy, it copies the whole library in activity-ID order and
 * resumes from the last copied ID on the next run; afterwards runs are
 * incremental. `full: true` restarts a full copy (the importer).
 */
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
  // The mirror writes as Postgres; Convex refuses each write otherwise.
  if (state.writer && state.writer !== 'postgres')
    throw new Error('The Convex owner is not written by Postgres');
  const epoch = state.epoch;
  const write = <T>(operation: { kind: string; [field: string]: unknown }) =>
    writer.write<T>(operation, epoch);
  const revision = Math.max(now(), (state.mirror?.revision ?? 0) + 1);
  const common = { generation: state.generation, sourceRevision: revision };
  const resume = full ? undefined : state.mirror?.full;
  const fullMode = full || !state.mirror || resume !== undefined;
  const result: MirrorResult = {
    mode: fullMode ? 'full' : 'incremental',
    activities: 0,
    applied: 0,
    deleted: 0,
    recordings: 0,
    matches: 0,
    photos: 0,
    photoErrors: 0,
    catalogueSelected: false,
    complete: true,
    checkpoint: {
      sequence: state.mirror?.sequence ?? 0,
      revision,
      ...(resume && { full: resume }),
      ...(state.mirror?.photos !== undefined && {
        photos: state.mirror.photos,
      }),
      ...(state.mirror?.photoSequence !== undefined && {
        photoSequence: state.mirror.photoSequence,
      }),
    },
  };

  /** Positions only move forward; `full: null` marks a finished full copy. */
  const save = async (
    next: {
      sequence?: number;
      full?: MirrorPosition['full'] | null;
      photos?: string | null;
      photoSequence?: number;
    } = {},
  ) => {
    const { full: progress, ...rest } = result.checkpoint;
    result.checkpoint = {
      ...rest,
      sequence: Math.max(rest.sequence, next.sequence ?? 0),
      ...(next.full === undefined
        ? progress && { full: progress }
        : next.full && { full: next.full }),
      ...(next.photos !== undefined && { photos: next.photos }),
      ...(next.photoSequence !== undefined && {
        photoSequence: Math.max(rest.photoSequence ?? 0, next.photoSequence),
      }),
    };
    await write({
      kind: 'checkpoint',
      sequence: result.checkpoint.sequence,
      revision,
      ...(next.full !== undefined && { full: next.full }),
      ...(next.photos !== undefined && { photos: next.photos }),
      ...(next.photoSequence !== undefined && {
        photoSequence: next.photoSequence,
      }),
    });
  };

  /** Make Convex's photos of `activityIds` equal the source's. Activities
   * Convex does not hold are skipped there. */
  const copyPhotos = async (activityIds: string[]) => {
    if (activityIds.length === 0) return;
    const sets = new Map<string, PhotoDTO[]>(activityIds.map((id) => [id, []]));
    for (const photo of await source.photos(activityIds))
      sets.get(photo.activity_id)?.push(photo);
    const items = [...sets].map(([activityId, photos]) => ({
      activityId,
      photos,
    }));
    for (const batch of batches(items)) {
      try {
        result.photos += await write<number>({
          kind: 'applyPhotoSets',
          ...common,
          items: batch,
        });
      } catch (error) {
        // Photos are secondary: a set Convex rejects must not stop the
        // activities, recordings and matches behind it from being copied.
        result.photoErrors += batch.length;
        log(
          `Photo sets of ${batch.length} activities were rejected: ${String(error)}`,
        );
      }
    }
  };

  // Select the Postgres catalogue before the first matches publish.
  let catalogue = state.catalogue;
  let matchingVersion = state.matchingVersion;
  let catalogueChecked = false;
  const ensureCatalogue = async (id: string) => {
    if (catalogueChecked) return;
    catalogueChecked = true;
    const { version } = await source.matches([id]);
    if (version === matchingVersion) return;
    catalogue = catalogueFor(version);
    matchingVersion = version;
    await write({ kind: 'selectCatalogue', catalogue, matchingVersion });
    result.catalogueSelected = true;
    log(`Selected catalogue for matching version ${version}`);
  };

  /** Copy the current state of `ids`. Anything but 'done' means the caller
   * stops before checkpointing this chunk: the time budget ran out between
   * steps, or the catalogue changed. Work already published stays, and the
   * next run skips it (identical metadata, current recordings and matches). */
  const copy = async (ids: string[]): Promise<'done' | 'stopped'> => {
    await ensureCatalogue(ids[0]!);
    result.activities += ids.length;
    const activities = await source.activities(ids);
    const present = new Set(activities.map((activity) => activity.id));
    const gone = ids.filter((id) => !present.has(id));
    for (const batch of batches(gone))
      result.deleted += await write<number>({
        kind: 'deleteSources',
        ...common,
        ids: batch,
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
    await copyPhotos([...present]);

    const recordings = needsRecording.size
      ? await source.payloads([...needsRecording])
      : [];
    for (let i = 0; i < recordings.length; i += RECORDING_BATCH) {
      if (now() > deadline) return 'stopped';
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
      if (now() > deadline) return 'stopped';
      const { version, results } = await source.matches([...needsMatch]);
      if (version !== matchingVersion) {
        log('The Postgres catalogue changed during the run; stopping early');
        return 'stopped';
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
    log(JSON.stringify({ ...result, checkpoint: undefined }));
    return 'done';
  };

  if (fullMode) {
    // Everything visible at `through` is copied; later changes are newer and
    // reach Convex through the incremental runs that follow.
    const through = resume?.through ?? (await source.latestSequence());
    let after: string | null = resume?.after ?? null;
    // A copy started by this code carries photos from its first activity;
    // one resumed from an older run is caught up afterwards.
    const photos = resume ? undefined : null;
    for (;;) {
      if (now() > deadline) {
        result.complete = false;
        break;
      }
      const ids = await source.activityIds(after, FULL_CHUNK);
      if (ids.length > 0 && (await copy(ids)) !== 'done') {
        result.complete = false;
        break;
      }
      if (ids.length < FULL_CHUNK) {
        await save({
          sequence: through,
          photoSequence: through,
          full: null,
          photos,
        });
        break;
      }
      after = ids.at(-1)!;
      await save({ full: { after, through }, photos });
    }
    return result;
  }

  const since = new Date(now() - overlapMs);
  // Photo changes have their own position, so neither resource's checkpoint
  // can pass the other's unprocessed changes. They run first and need
  // nothing from the activity pass: a photo whose activity Convex does not
  // hold yet is skipped there and arrives with that activity's copy, which
  // is still ahead of the activity position.
  const changedPhotos = await source.changedPhotos(
    result.checkpoint.photoSequence ?? result.checkpoint.sequence,
    since,
    maxActivities + 1,
  );
  if (changedPhotos.length > maxActivities) {
    changedPhotos.length = maxActivities;
    result.complete = false;
  }
  for (let i = 0; i < changedPhotos.length; i += CHUNK) {
    if (now() > deadline) {
      result.complete = false;
      return result;
    }
    const slice = changedPhotos.slice(i, i + CHUNK);
    const ids = slice.map((item) => item.id);
    const located = await source.photoActivities(ids);
    const existing = new Set(located.map((item) => item.id));
    for (const gone of batches(ids.filter((id) => !existing.has(id))))
      result.photos += await write<number>({
        kind: 'deletePhotos',
        ...common,
        ids: gone,
      });
    await copyPhotos([...new Set(located.map((item) => item.activityId))]);
    // Sorted by latest sequence, as for activities below.
    await save({
      photoSequence: Math.max(...slice.map((item) => item.sequence)),
    });
  }

  const changed = await source.changedActivities(
    result.checkpoint.sequence,
    since,
    maxActivities + 1,
  );
  if (changed.length > maxActivities) {
    changed.length = maxActivities;
    result.complete = false;
  }
  if (changed.length === 0) await save();
  for (let i = 0; i < changed.length; i += CHUNK) {
    if (now() > deadline) {
      result.complete = false;
      break;
    }
    const slice = changed.slice(i, i + CHUNK);
    if ((await copy(slice.map((item) => item.id))) !== 'done') {
      result.complete = false;
      break;
    }
    // Sorted by latest sequence: every later activity's latest change is
    // above this chunk's, so the checkpoint can safely move to it.
    await save({ sequence: Math.max(...slice.map((item) => item.sequence)) });
  }

  // One-time catch-up for a library copied before photos were mirrored.
  if (result.checkpoint.photos !== null) {
    let after = result.checkpoint.photos ?? null;
    for (;;) {
      if (now() > deadline) {
        result.complete = false;
        break;
      }
      const ids = await source.activityIds(after, CHUNK);
      await copyPhotos(ids);
      if (ids.length < CHUNK) {
        await save({ photos: null });
        break;
      }
      after = ids.at(-1)!;
      await save({ photos: after });
    }
  }
  return result;
}
