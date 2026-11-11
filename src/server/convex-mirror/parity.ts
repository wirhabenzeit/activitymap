import type { ActivityDTO } from '~/contracts/v1/activity';
import type { ActivityStreamSummaryDTO } from '~/contracts/v1/activity-streams';
import type { PhotoDTO } from '~/contracts/v1/photo';

import { type Difference, createComparison } from './compare';
import type { MirrorPosition } from './mirror';

/**
 * Scheduled parity check for shadow owners: compares what the v1 handlers
 * serve from Postgres with what the Convex application backend holds, for a
 * bounded sample of activities per run.
 *
 * The sample is a window over the owner's activity IDs that rotates with the
 * clock (so hourly runs cover the whole library over time without stored
 * state) plus every activity changed recently. Activities with changes the
 * mirror has not checkpointed yet are skipped rather than reported as drift.
 *
 * Photos are compared as the photo set of each sampled activity, so a photo
 * Convex should no longer hold is found too. A set is skipped while one of
 * its photos has a change the mirror's photo position has not passed.
 */

/** What production serves from Postgres, as the v1 handlers build it. */
export type ParityPostgres = {
  /** The owner's activity IDs, ascending. */
  activityIds(): Promise<string[]>;
  /** Activities with a change since `since`, most recent first. Includes
   * deleted activities. */
  changedSince(since: Date, limit: number): Promise<string[]>;
  /** Each activity's latest change among `ids`; activities without recorded
   * changes are absent. */
  latestChanges(
    ids: string[],
  ): Promise<Map<string, { sequence: number; changedAt: Date }>>;
  /** Bootstrap items (with place matches) for the owned activities among
   * `ids`. */
  activities(ids: string[]): Promise<ActivityDTO[]>;
  /** Stream summaries for the owned activities among `ids`. */
  summaries(ids: string[]): Promise<ActivityStreamSummaryDTO[]>;
  /** The photos of the owned activities among `activityIds`. */
  photos(activityIds: string[]): Promise<PhotoDTO[]>;
  /** Each photo's latest change among `ids` (photo IDs), as
   * `latestChanges`. */
  latestPhotoChanges(
    ids: string[],
  ): Promise<Map<string, { sequence: number; changedAt: Date }>>;
};

/** What the Convex application backend serves for the same reads. */
export type ParityConvex = Pick<
  ParityPostgres,
  'activities' | 'summaries' | 'photos'
>;

export type ParityReport = {
  status: 'ok' | 'drift';
  /** `in-progress`: a full copy is running, and only activities it has
   * already passed are compared. `not-started`: nothing to compare yet. */
  copy: 'complete' | 'in-progress' | 'not-started';
  /** Changes up to this sequence must be in Convex. */
  checkpoint: number | null;
  sampled: number;
  /** Activities with changes the mirror has not checkpointed yet. */
  inFlight: number;
  compared: { activities: number; summaries: number; photos: number };
  expectedDifferences: Record<string, number>;
  differences: Record<string, Difference>;
};

const isActivityId = (id: string) => /^[1-9]\d{0,19}$/.test(id);

/** Window `index` of `size` items, rotating through `ids`. */
export function rotatingWindow<T>(ids: T[], size: number, index: number) {
  if (ids.length <= size) return ids;
  const windows = Math.ceil(ids.length / size);
  const start = (index % windows) * size;
  return ids.slice(start, start + size);
}

export async function checkParity({
  position,
  postgres,
  convex,
  now = Date.now(),
  windowSize = 200,
  recentLimit = 200,
  recentMs = 24 * 60 * 60_000,
  intervalMs = 60 * 60_000,
  settleMs = 15 * 60_000,
}: {
  /** The mirror's checkpoint (`importer:mirrorState` → `mirror`). */
  position: MirrorPosition | null;
  postgres: ParityPostgres;
  convex: ParityConvex;
  now?: number;
  /** Activities per rotating window. */
  windowSize?: number;
  /** Most recently changed activities added to each sample. */
  recentLimit?: number;
  recentMs?: number;
  /** The schedule's interval; the window advances once per interval. */
  intervalMs?: number;
  /** Changes this recent are in flight even below the checkpoint: the mirror
   * replays such a window because lower sequences can commit late. */
  settleMs?: number;
}): Promise<ParityReport> {
  const comparison = createComparison();
  const report = (
    fields: Partial<ParityReport> & Pick<ParityReport, 'copy'>,
  ): ParityReport => {
    const differences = comparison.differences();
    return {
      status: Object.keys(differences).length > 0 ? 'drift' : 'ok',
      checkpoint: null,
      sampled: 0,
      inFlight: 0,
      compared: { activities: 0, summaries: 0, photos: 0 },
      differences,
      ...fields,
      expectedDifferences: {
        ...comparison.expected(),
        ...fields.expectedDifferences,
      },
    };
  };
  if (!position) return report({ copy: 'not-started' });

  // A full copy has copied every activity up to `after` as of `through` or
  // later; everything else reaches Convex once the copy finishes.
  const full = position.full;
  const checkpoint = full ? full.through : position.sequence;
  const copied = (id: string) =>
    isActivityId(id) && (!full || BigInt(id) <= BigInt(full.after));

  const ids = (await postgres.activityIds()).filter(copied);
  const window = rotatingWindow(ids, windowSize, Math.floor(now / intervalMs));
  const recent = (
    await postgres.changedSince(new Date(now - recentMs), recentLimit)
  ).filter(copied);
  const sample = [...new Set([...window, ...recent])];
  const copy = full ? 'in-progress' : 'complete';
  if (sample.length === 0) return report({ copy, checkpoint });

  // Read Postgres, then Convex, then the change log: a change that reached
  // either side before its read is in the log by the time it is read, so it
  // is either below the checkpoint (and must match) or skipped.
  const served = {
    postgres: await postgres.activities(sample),
    convex: await convex.activities(sample),
  };
  const summaries = {
    postgres: await postgres.summaries(sample),
    convex: await convex.summaries(sample),
  };
  // Photos reach Convex with a full copy, or through the catch-up pass that
  // follows a copy made before photos were mirrored.
  const caughtUp = position.photos;
  const withPhotos = sample.filter(
    (id) =>
      caughtUp === null ||
      (caughtUp !== undefined && BigInt(id) <= BigInt(caughtUp)),
  );
  const photos = {
    postgres: await postgres.photos(withPhotos),
    convex: await convex.photos(withPhotos),
  };
  const changes = await postgres.latestChanges(sample);
  const isSettled = (
    change: { sequence: number; changedAt: Date } | undefined,
    position: number,
  ) =>
    !change ||
    (change.sequence <= position &&
      change.changedAt.getTime() <= now - settleMs);
  const settled = new Set(
    sample.filter((id) => isSettled(changes.get(id), checkpoint)),
  );
  // A photo change is in flight for the whole set of its activity, on
  // whichever side still lists the photo.
  const photoCheckpoint = full
    ? full.through
    : (position.photoSequence ?? position.sequence);
  const photoChanges = await postgres.latestPhotoChanges([
    ...new Set(
      [...photos.postgres, ...photos.convex].map((item) => item.unique_id),
    ),
  ]);
  const photosInFlight = new Set(
    [...photos.postgres, ...photos.convex]
      .filter(
        (item) => !isSettled(photoChanges.get(item.unique_id), photoCheckpoint),
      )
      .map((item) => item.activity_id),
  );
  const settledPhotos = (items: PhotoDTO[]) =>
    items.filter(
      (item) =>
        settled.has(item.activity_id) && !photosInFlight.has(item.activity_id),
    );

  // A recording Postgres gave up fetching: it holds a record of the failure
  // and nothing else, and Convex holds nothing, which is the same library.
  // Convex asks the provider again after the account moves.
  const convexStatus = new Map(
    summaries.convex.map((item) => [
      item.activity_id,
      item.metadata?.fetch_status,
    ]),
  );
  const neverFetched = new Set(
    summaries.postgres
      .filter(
        (item) =>
          item.metadata?.fetch_status === 'failed' &&
          item.metadata.state === 'not_fetched' &&
          (convexStatus.get(item.activity_id) ?? 'not_fetched') ===
            'not_fetched',
      )
      .map((item) => item.activity_id),
  );
  const withoutRecording = <T extends { id: string }>(item: T): T =>
    neverFetched.has(item.id)
      ? { ...item, streams: undefined, placeMatches: undefined }
      : item;

  const activities = {
    postgres: served.postgres
      .filter((item) => settled.has(item.id))
      .map(withoutRecording),
    convex: served.convex
      .filter((item) => settled.has(item.id))
      .map(withoutRecording),
  };
  comparison.compareItems(
    'activity',
    activities.postgres,
    activities.convex,
    (item) => item.id,
  );
  const summaryKey = (item: ActivityStreamSummaryDTO) => item.activity_id;
  const settledSummaries = {
    postgres: summaries.postgres.filter(
      (item) =>
        settled.has(summaryKey(item)) && !neverFetched.has(summaryKey(item)),
    ),
    convex: summaries.convex.filter(
      (item) =>
        settled.has(summaryKey(item)) && !neverFetched.has(summaryKey(item)),
    ),
  };
  comparison.compareItems(
    'summary',
    settledSummaries.postgres,
    settledSummaries.convex,
    summaryKey,
  );

  const comparedPhotos = {
    postgres: settledPhotos(photos.postgres),
    convex: settledPhotos(photos.convex),
  };
  comparison.compareItems(
    'photo',
    comparedPhotos.postgres,
    comparedPhotos.convex,
    (item) => item.unique_id,
  );

  return report({
    copy,
    checkpoint,
    expectedDifferences: [...neverFetched].some((id) => settled.has(id))
      ? {
          'recording.neverFetched': [...neverFetched].filter((id) =>
            settled.has(id),
          ).length,
        }
      : {},
    sampled: sample.length,
    inFlight: sample.length - settled.size,
    compared: {
      activities: new Set(
        [...activities.postgres, ...activities.convex].map((item) => item.id),
      ).size,
      summaries: settledSummaries.postgres.length,
      photos: comparedPhotos.postgres.length,
    },
  });
}
