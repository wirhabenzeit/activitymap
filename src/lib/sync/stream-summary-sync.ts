import {
  captureStreamSummaryFence,
  fetchActivityStreamSummary,
  fetchStoredStreamSummaryBatch,
  isStreamSummaryFenceCurrent,
  rememberInitialMetadata,
  STREAM_SUMMARY_PREFETCH_BATCH,
  StreamSummarySupersededError,
  type StreamSummaryResult,
} from '~/lib/activity-stream-summary';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import { hasCompactElevationProfile } from '~/lib/streams/compact-summary';
import {
  canReuseCachedStreamSummary,
  type CachedStreamSummary,
} from '~/lib/streams/summary-cache-record';
import * as defaultStore from './v1-store';

const missingSummaries = new Map<
  string,
  { metadata: string; retryAt: number; scope: number }
>();
const MISSING_RETRY_MS = 15 * 60_000;
const metadataKey = (metadata: StreamMetadata | undefined) =>
  `${metadata?.generation}:${metadata?.revision}:${metadata?.state}`;

export function clearStreamSummarySyncAttempts(userId: string) {
  for (const key of missingSummaries.keys()) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
    if (key.startsWith(`${userId}\u0000`)) missingSummaries.delete(key);
  }
}

export type StreamSummaryStore = Pick<
  typeof defaultStore,
  | 'getCachedStreamSummaries'
  | 'putCachedStreamSummaries'
  | 'getCachedActivityDTOs'
>;

const asResult = (record: CachedStreamSummary): StreamSummaryResult => ({
  summary: record.data.summary,
  metadata: record.data.metadata,
  requestedAgainst: record.requestedAgainst,
  status: hasCompactElevationProfile(record.data.summary)
    ? 'ready'
    : 'unavailable',
  message: null,
  retryAt: null,
  pollStartedAt: 0,
  pollAttempts: 0,
});

const asRecord = (
  id: string,
  result: StreamSummaryResult,
): CachedStreamSummary | null =>
  result.metadata?.state === 'current' && result.summary
    ? {
        data: {
          activity_id: id,
          metadata: result.metadata,
          summary: result.summary,
          last_error: null,
          next_retry_at: null,
        },
        requestedAgainst: result.requestedAgainst,
      }
    : null;

/** Cache-first detail loading retains the existing authoritative demand fallback. */
export async function loadActivityStreamSummary(
  options: Parameters<typeof fetchActivityStreamSummary>[0] & {
    store?: StreamSummaryStore;
  },
): Promise<StreamSummaryResult> {
  const store = options.store ?? defaultStore;
  const scope = `auth:${options.userId}`;
  rememberInitialMetadata(
    options.userId,
    options.activityId,
    options.observedMetadata,
  );
  const fence = captureStreamSummaryFence(options.userId, options.activityId);
  const isCurrent = () =>
    !options.signal.aborted && isStreamSummaryFenceCurrent(fence);
  const cached = await store
    .getCachedStreamSummaries(scope, [options.activityId])
    .catch(() => new Map<string, CachedStreamSummary>());
  if (!isCurrent()) throw new StreamSummarySupersededError();
  const record = cached.get(options.activityId);
  if (canReuseCachedStreamSummary(record, options.observedMetadata))
    return asResult(record!);
  const result = await fetchActivityStreamSummary(options);
  if (!isCurrent()) throw new StreamSummarySupersededError();
  const fresh = asRecord(options.activityId, result);
  if (fresh) {
    // Cache quota/private browsing failures must not hide a fresh profile.
    await store
      .putCachedStreamSummaries(scope, [fresh], isCurrent)
      .catch(() => undefined);
  }
  if (!isCurrent()) throw new StreamSummarySupersededError();
  return result;
}

/** Also used by visible-card prefetch; a warm browser never needs a network call. */
export async function loadStoredStreamSummaryBatch(
  options: Parameters<typeof fetchStoredStreamSummaryBatch>[0] & {
    store?: StreamSummaryStore;
  },
): Promise<Map<string, StreamSummaryResult>> {
  const store = options.store ?? defaultStore;
  const scope = `auth:${options.userId}`;
  const ids = [...new Set(options.activityIds)].slice(
    0,
    STREAM_SUMMARY_PREFETCH_BATCH,
  );
  const fences = new Map(
    ids.map((id) => {
      rememberInitialMetadata(
        options.userId,
        id,
        options.observedMetadata?.get(id),
      );
      return [id, captureStreamSummaryFence(options.userId, id)];
    }),
  );
  const isCurrent = (id: string) =>
    !options.signal.aborted && isStreamSummaryFenceCurrent(fences.get(id)!);
  const cached = await store.getCachedStreamSummaries(scope, ids);
  options.signal.throwIfAborted();
  const results = new Map<string, StreamSummaryResult>();
  const missing = ids.filter((id) => {
    if (!isCurrent(id)) return false;
    const record = cached.get(id);
    if (!canReuseCachedStreamSummary(record, options.observedMetadata?.get(id)))
      return true;
    results.set(id, asResult(record!));
    return false;
  });
  if (missing.length) {
    const fetched = await fetchStoredStreamSummaryBatch({
      ...options,
      activityIds: missing,
    });
    const records: CachedStreamSummary[] = [];
    for (const [id, result] of fetched) {
      if (!isCurrent(id)) continue;
      results.set(id, result);
      const record = asRecord(id, result);
      if (record) records.push(record);
    }
    await store.putCachedStreamSummaries(scope, records, isCurrent);
  }
  for (const id of results.keys()) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
    if (!isCurrent(id)) results.delete(id);
  }
  return results;
}

/**
 * Run after activity catch-up, including for libraries bootstrapped before this
 * store existed. One <=100-ID request at a time bounds memory and server work;
 * successful batches are durable, so cancellation/retry resumes missing data.
 * Only server-current streams are candidates: this never starts a Strava fetch.
 */
export async function syncStoredStreamSummaries(options: {
  userId: string;
  signal: AbortSignal;
  store?: StreamSummaryStore;
  fetchImpl?: Parameters<typeof fetchStoredStreamSummaryBatch>[0]['fetchImpl'];
  onResults?: (results: Map<string, StreamSummaryResult>) => void;
  now?: () => number;
}): Promise<void> {
  const store = options.store ?? defaultStore;
  const fence = captureStreamSummaryFence(options.userId, '');
  const activities = await store.getCachedActivityDTOs(
    `auth:${options.userId}`,
  );
  options.signal.throwIfAborted();
  const present = new Set(
    activities.map((activity) => `${options.userId}\u0000${activity.id}`),
  );
  for (const key of missingSummaries.keys()) {
    if (key.startsWith(`${options.userId}\u0000`) && !present.has(key)) {
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
      missingSummaries.delete(key);
    }
  }
  const now = options.now ?? Date.now;
  const metadata = new Map<string, StreamMetadata | undefined>(
    activities
      .filter((activity) => {
        if (activity.streams?.state !== 'current') return false;
        const miss = missingSummaries.get(
          `${options.userId}\u0000${activity.id}`,
        );
        return (
          miss?.scope !== fence.scope ||
          miss.metadata !== metadataKey(activity.streams) ||
          miss.retryAt <= now()
        );
      })
      .sort((left, right) => right.start_date.localeCompare(left.start_date))
      .map((activity) => [activity.id, activity.streams]),
  );
  const ids = [...metadata.keys()];
  for (
    let start = 0;
    start < ids.length;
    start += STREAM_SUMMARY_PREFETCH_BATCH
  ) {
    options.signal.throwIfAborted();
    if (!isStreamSummaryFenceCurrent(fence))
      throw new StreamSummarySupersededError();
    const batch = ids.slice(start, start + STREAM_SUMMARY_PREFETCH_BATCH);
    const results = await loadStoredStreamSummaryBatch({
      ...options,
      store,
      activityIds: batch,
      observedMetadata: metadata,
    });
    options.signal.throwIfAborted();
    if (!isStreamSummaryFenceCurrent(fence))
      throw new StreamSummarySupersededError();
    for (const id of batch) {
      const key = `${options.userId}\u0000${id}`;
      if (results.get(id)?.summary) {
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
        missingSummaries.delete(key);
      } else {
        missingSummaries.set(key, {
          metadata: metadataKey(metadata.get(id)),
          retryAt: now() + MISSING_RETRY_MS,
          scope: fence.scope,
        });
      }
    }
    options.onResults?.(results);
  }
}
