import { z } from 'zod';

import type {
  IngestionScheduling,
  IngestionStatusDTO,
} from '~/contracts/v1/ingestion-status';
import {
  STRAVA_FRESHNESS_LIMIT_MS,
  SUMMARY_RECONCILIATION_INTERVAL_MS,
} from '~/server/strava/summary-reconciliation';

const count = z.number().int().nonnegative();
const countsSchema = z.object({
  total: count,
  detailed: count,
  neverFetched: count,
  invalidatedDetails: count,
  activitiesWithPhotos: count,
  activitiesWithStoredPhotos: count,
  currentPhotos: count,
  refreshRequiredPhotos: count,
  unknownPhotos: count,
  photoCount: count,
  withData: count,
  withoutData: count,
  runnable: count,
  waiting: count,
  blocked: count,
  invalidatedStreams: count,
  chartSummaries: count,
});

export const statusPageSchema = z.object({
  counts: countsSchema,
  oldest: z.string().nullable(),
  newest: z.string().nullable(),
  retryAt: z.number().nullable(),
  next: z.number().nullable(),
  active: z.boolean(),
  lastSummaryReconciledAt: z.number().nullable(),
});

export async function previewIngestionStatus(
  load: (after: number | null) => Promise<z.infer<typeof statusPageSchema>>,
  observedAt: Date,
): Promise<IngestionStatusDTO> {
  const head = await load(null);
  const { counts } = head;
  let { oldest, newest, retryAt } = head;
  let page = head;
  while (page.next !== null) {
    page = await load(page.next);
    for (const key of Object.keys(
      countsSchema.shape,
    ) as (keyof typeof counts)[])
      counts[key] += page.counts[key];
    if (page.oldest !== null && (oldest === null || page.oldest < oldest))
      oldest = page.oldest;
    if (page.newest !== null && (newest === null || page.newest > newest))
      newest = page.newest;
    if (page.retryAt !== null && (retryAt === null || page.retryAt < retryAt))
      retryAt = page.retryAt;
  }
  const complete = head.lastSummaryReconciledAt !== null;
  const age = observedAt.getTime() - (head.lastSummaryReconciledAt ?? 0);
  const iso = (value: number | null) =>
    value === null ? null : new Date(value).toISOString();
  const scheduled = (scheduling: IngestionScheduling) => ({
    scheduling,
    schedulingReason: null,
    retryAt: null,
  });
  const detailPending = counts.neverFetched + counts.invalidatedDetails;
  const photoPending =
    counts.activitiesWithPhotos - counts.activitiesWithStoredPhotos;
  const streamPending = counts.runnable + counts.waiting + counts.blocked;
  const streamsScheduling =
    streamPending === 0
      ? 'idle'
      : counts.blocked > 0
        ? 'blocked'
        : !head.active
          ? 'not_scheduled'
          : counts.runnable > 0
            ? 'scheduled'
            : 'waiting';
  return {
    observedAt: observedAt.toISOString(),
    history: {
      progress: complete ? 'complete' : 'unknown',
      ...scheduled('not_scheduled'),
      lastOutcome: null,
      knownActivityCount: counts.total,
      totalActivityCount: complete ? counts.total : null,
      oldestActivityStart: oldest,
      newestActivityStart: newest,
      reconciliation: {
        phase: 'idle',
        pagesScanned: null,
        scanStartedAt: null,
        lastCompletedAt: iso(head.lastSummaryReconciledAt),
        nextDueAt: null,
        freshness: !complete
          ? 'never_completed'
          : age >= STRAVA_FRESHNESS_LIMIT_MS
            ? 'overdue'
            : age >= SUMMARY_RECONCILIATION_INTERVAL_MS
              ? 'due'
              : 'current',
      },
    },
    details: {
      progress:
        detailPending === 0
          ? 'complete'
          : counts.detailed > 0
            ? 'in_progress'
            : 'not_started',
      ...scheduled(detailPending === 0 ? 'idle' : 'not_scheduled'),
      lastOutcome: null,
      detailed: counts.detailed,
      neverFetched: counts.neverFetched,
      invalidated: counts.invalidatedDetails,
      retryWaiting: 0,
    },
    photos: {
      progress:
        photoPending === 0
          ? 'complete'
          : counts.activitiesWithStoredPhotos > 0
            ? 'in_progress'
            : 'not_started',
      ...scheduled(
        photoPending === 0 && counts.refreshRequiredPhotos === 0
          ? 'idle'
          : 'not_scheduled',
      ),
      activitiesWithPhotos: counts.activitiesWithPhotos,
      activitiesWithStoredPhotos: counts.activitiesWithStoredPhotos,
      current: counts.currentPhotos,
      refreshRequired: counts.refreshRequiredPhotos,
      unknown: counts.unknownPhotos,
      photoCount: counts.photoCount,
    },
    streams: {
      progress:
        streamPending === 0
          ? 'complete'
          : counts.withData + counts.withoutData > 0
            ? 'in_progress'
            : 'not_started',
      scheduling: streamsScheduling,
      schedulingReason:
        streamsScheduling === 'blocked' ? 'credentials_unavailable' : null,
      retryAt: iso(retryAt),
      withData: counts.withData,
      withoutData: counts.withoutData,
      runnable: counts.runnable,
      waiting: counts.waiting,
      blocked: counts.blocked,
      failed: 0,
      invalidated: counts.invalidatedStreams,
      chartSummaries: counts.chartSummaries,
    },
  };
}
