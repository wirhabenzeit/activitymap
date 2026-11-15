import { strToU8, zipSync } from 'fflate';

import type { Activity } from '~/lib/activity';
import {
  activityGPXCoordinates,
  activityGPXDocument,
  activityGPXFileNames,
  routeWithElevation,
} from '~/lib/activity-gpx';
import { STREAM_SUMMARY_PREFETCH_BATCH } from '~/lib/activity-stream-summary';
import { decodeStreamSummary } from '~/lib/streams/compact-summary';
import { authenticatedLibraryScope } from '~/lib/sync/library-owner';
import { loadLiveActivityDetail } from '~/lib/sync/live-detail';
import { loadStoredStreamSummaryBatch } from '~/lib/sync/stream-summary-sync';

export type GPXArchive = {
  blob: Blob;
  fileName: string;
  /** Tracks written to the archive. */
  exported: number;
  /** Of those, tracks that carry elevation. */
  withElevation: number;
  /** Activities without any route (manual entries, indoor rides). */
  skipped: number;
};

/**
 * Stored stream summaries only: this reads the browser cache and the stored
 * batch endpoint, so exporting never costs a Strava request. Activities whose
 * streams are not stored yet are exported without elevation.
 */
async function storedSummaries(
  activities: readonly Activity[],
  userId: string,
  signal: AbortSignal,
) {
  const summaries = new Map<string, ReturnType<typeof decodeStreamSummary>>();
  const metadata = new Map(
    activities.map((activity) => [
      String(activity.id),
      activity.streamsMetadata,
    ]),
  );
  const ids = [...metadata.keys()];
  for (
    let start = 0;
    start < ids.length;
    start += STREAM_SUMMARY_PREFETCH_BATCH
  ) {
    try {
      const results = await loadStoredStreamSummaryBatch({
        activityIds: ids.slice(start, start + STREAM_SUMMARY_PREFETCH_BATCH),
        userId,
        signal,
        observedMetadata: metadata,
      });
      for (const [id, result] of results) {
        if (result.status !== 'ready' || !result.summary) continue;
        try {
          summaries.set(id, decodeStreamSummary(result.summary));
        } catch {
          /* An unreadable summary only costs this track its elevation. */
        }
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return summaries;
}

export async function buildActivitiesGPXArchive(
  activities: readonly Activity[],
  userId: string,
  signal: AbortSignal,
  now: Date = new Date(),
): Promise<GPXArchive> {
  const summaries = await storedSummaries(activities, userId, signal);
  const names = activityGPXFileNames(activities);
  const files: Record<string, Uint8Array> = {};
  let withElevation = 0;
  let skipped = 0;

  for (const [index, activity] of activities.entries()) {
    signal.throwIfAborted();
    // Live preview libraries hold cards without the detailed polyline.
    const detail = activity.map_polyline
      ? null
      : await loadLiveActivityDetail(
          authenticatedLibraryScope(userId),
          String(activity.id),
        ).catch(() => null);
    const points = routeWithElevation(
      activityGPXCoordinates(detail ?? activity),
      summaries.get(String(activity.id)),
    );
    if (points.length === 0) {
      skipped++;
      continue;
    }
    if (points.some((point) => point[2] !== undefined)) withElevation++;
    files[names[index]!] = strToU8(
      activityGPXDocument({
        name: String(activity.name),
        time: activity.start_date,
        description: activity.description,
        points,
      }),
    );
  }

  const exported = Object.keys(files).length;
  // Copy into a fresh ArrayBuffer-backed view so Blob accepts it.
  const archive = zipSync(files, { level: 6 });
  return {
    blob: new Blob([new Uint8Array(archive)], { type: 'application/zip' }),
    fileName: `activitymap-${exported}-activities-${now.toISOString().slice(0, 10)}.zip`,
    exported,
    withElevation,
    skipped,
  };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
