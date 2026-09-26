import type { QueryClient } from '@tanstack/react-query';

import {
  activityStreamSummariesDTOSchema,
  activityStreamSummaryDTOSchema,
  type ActivityStreamSummaryDTO,
  type StreamMetadata,
} from '~/contracts/v1/activity-streams';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';

export type ElevationProfile = { altitude: number[]; distance: number[] };

export type StreamSummaryResult = {
  profile: ElevationProfile | null;
  metadata: StreamMetadata | null;
  requestedAgainst: StreamMetadata | null;
  status: 'ready' | 'pending' | 'unavailable' | 'failed';
  message: string | null;
  retryAt: number | null;
  pollStartedAt: number;
  pollAttempts: number;
};

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export const STREAM_SUMMARY_QUERY_ROOT = [
  'activity-stream-summary',
  'v1',
] as const;
export const STREAM_SUMMARY_PREFETCH_BATCH = 100;
export const STREAM_SUMMARY_PREFETCH_CONCURRENCY = 2;
export const STREAM_SUMMARY_MAX_POLL_ATTEMPTS = 20;
export const STREAM_SUMMARY_MAX_POLL_MS = 10 * 60_000;

const DEFAULT_PENDING_RETRY_MS = 3_000;
const DEFAULT_ERROR_RETRY_MS = 60_000;

export const streamSummaryQueryKey = (userId: string, activityId: string) => [
  ...STREAM_SUMMARY_QUERY_ROOT,
  userId,
  activityId,
];

export function streamSummaryRefetchInterval(
  result: StreamSummaryResult | undefined,
  now = Date.now(),
): number | false {
  return result?.status === 'pending' && result.retryAt !== null
    ? Math.max(1, result.retryAt - now)
    : false;
}

export function toElevationProfile({
  metadata,
  summary,
}: ActivityStreamSummaryDTO): ElevationProfile | null {
  const distance = summary?.distance;
  const altitude = summary?.altitude;
  if (
    metadata.state !== 'current' ||
    !distance?.length ||
    distance.length !== altitude?.length
  )
    return null;
  const forward =
    distance.length > 1 &&
    distance[distance.length - 1]! > distance[0]! &&
    distance.every(
      (value, index) => index === 0 || value >= distance[index - 1]!,
    );
  return forward ? { altitude, distance } : null;
}

/** Parses both delta-seconds and HTTP-date Retry-After forms. */
export function parseRetryAfterMs(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}

const sameMetadata = (
  left: StreamMetadata | null | undefined,
  right: StreamMetadata | null | undefined,
) =>
  (left?.generation ?? null) === (right?.generation ?? null) &&
  (left?.revision ?? '0') === (right?.revision ?? '0') &&
  (left?.state ?? 'not_fetched') === (right?.state ?? 'not_fetched');

const revision = (metadata: StreamMetadata): bigint =>
  BigInt(metadata.revision);

/**
 * A direct response is authoritative over the metadata the request observed.
 * Later same-generation metadata can only move revisions forward. Opaque
 * generation changes are conservatively treated as invalidations.
 */
export function isStreamSummaryCurrent(
  result: StreamSummaryResult | undefined,
  observed: StreamMetadata | undefined,
): boolean {
  if (
    result?.status !== 'ready' ||
    !result.profile ||
    result.metadata?.state !== 'current'
  )
    return false;
  if (!observed) return true;
  if (sameMetadata(observed, result.metadata)) return true;

  if (sameMetadata(observed, result.requestedAgainst)) {
    // The response was fetched after this exact metadata was observed.
    return true;
  }

  if (
    observed.generation !== null &&
    observed.generation === result.metadata.generation
  ) {
    return (
      observed.state === 'current' &&
      revision(result.metadata) >= revision(observed)
    );
  }
  return false;
}

export function isStreamSummaryResultReusable(
  result: StreamSummaryResult | undefined,
  observed: StreamMetadata | undefined,
): boolean {
  if (!result) return false;
  if (result.status === 'ready')
    return isStreamSummaryCurrent(result, observed);
  if (!observed) return true;
  return (
    sameMetadata(observed, result.metadata) ||
    sameMetadata(observed, result.requestedAgainst)
  );
}

const scopeFence = new Map<string, number>();
const activityFence = new Map<string, number>();
const observedMetadata = new Map<string, StreamMetadata | undefined>();
const fenceKey = (userId: string, activityId: string) =>
  `${userId}\u0000${activityId}`;

const rememberInitialMetadata = (
  userId: string,
  activityId: string,
  metadata: StreamMetadata | undefined,
) => {
  const key = fenceKey(userId, activityId);
  if (!observedMetadata.has(key)) observedMetadata.set(key, metadata);
};

export type StreamSummaryFence = {
  userId: string;
  activityId: string;
  scope: number;
  activity: number;
};

export function captureStreamSummaryFence(
  userId: string,
  activityId: string,
): StreamSummaryFence {
  return {
    userId,
    activityId,
    scope: scopeFence.get(userId) ?? 0,
    activity: activityFence.get(fenceKey(userId, activityId)) ?? 0,
  };
}

export function isStreamSummaryFenceCurrent(fence: StreamSummaryFence) {
  return (
    (scopeFence.get(fence.userId) ?? 0) === fence.scope &&
    (activityFence.get(fenceKey(fence.userId, fence.activityId)) ?? 0) ===
      fence.activity
  );
}

export function fenceStreamSummaryActivity(userId: string, activityId: string) {
  const key = fenceKey(userId, activityId);
  activityFence.set(key, (activityFence.get(key) ?? 0) + 1);
}

export function fenceStreamSummaryScope(userId: string) {
  scopeFence.set(userId, (scopeFence.get(userId) ?? 0) + 1);
}

export class StreamSummarySupersededError extends Error {
  constructor() {
    super('The stream summary request was superseded.');
    this.name = 'AbortError';
  }
}

const assertFence = (fence: StreamSummaryFence) => {
  if (!isStreamSummaryFenceCurrent(fence))
    throw new StreamSummarySupersededError();
};

function pendingResult(options: {
  previous?: StreamSummaryResult;
  requestedAgainst?: StreamMetadata;
  metadata?: StreamMetadata | null;
  retryAfterMs: number;
  now: number;
  message?: string;
}): StreamSummaryResult {
  const previous =
    options.previous?.status === 'pending' ? options.previous : undefined;
  const pollStartedAt = previous?.pollStartedAt ?? options.now;
  const pollAttempts = (previous?.pollAttempts ?? 0) + 1;
  const retryAt = options.now + options.retryAfterMs;
  if (
    pollAttempts >= STREAM_SUMMARY_MAX_POLL_ATTEMPTS ||
    retryAt - pollStartedAt > STREAM_SUMMARY_MAX_POLL_MS
  ) {
    return {
      profile: null,
      metadata: options.metadata ?? null,
      requestedAgainst: options.requestedAgainst ?? null,
      status: 'failed',
      message: 'Elevation data is still being prepared. Try again later.',
      retryAt: null,
      pollStartedAt,
      pollAttempts,
    };
  }
  return {
    profile: null,
    metadata: options.metadata ?? null,
    requestedAgainst: options.requestedAgainst ?? null,
    status: 'pending',
    message: options.message ?? null,
    retryAt,
    pollStartedAt,
    pollAttempts,
  };
}

export async function fetchActivityStreamSummary(options: {
  activityId: string;
  userId: string;
  signal: AbortSignal;
  observedMetadata?: StreamMetadata;
  previous?: StreamSummaryResult;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<StreamSummaryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  rememberInitialMetadata(
    options.userId,
    options.activityId,
    options.observedMetadata,
  );
  const fence = captureStreamSummaryFence(options.userId, options.activityId);
  const response = await fetchImpl(
    `/api/v1/activities/${options.activityId}/streams/summary`,
    {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    },
  );
  const body: unknown = await response.json();
  // Delta-seconds starts when the response is received. Reading the clock
  // after transport/body work is conservative and cannot shorten that delay.
  const now = options.now?.() ?? Date.now();
  assertFence(fence);

  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(body);
    const retryableStatus = response.status === 429 || response.status === 503;
    if (retryableStatus && parsed.success && parsed.data.error.retryable) {
      const retryAfterMs =
        parseRetryAfterMs(response.headers.get('Retry-After'), now) ??
        DEFAULT_ERROR_RETRY_MS;
      return pendingResult({
        previous: options.previous,
        requestedAgainst: options.observedMetadata,
        retryAfterMs,
        now,
        message: parsed.data.error.message,
      });
    }
    if (response.status === 404) {
      return {
        profile: null,
        metadata: null,
        requestedAgainst: options.observedMetadata ?? null,
        status: 'unavailable',
        message: 'Elevation data is unavailable for this activity.',
        retryAt: null,
        pollStartedAt: now,
        pollAttempts: 1,
      };
    }
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : 'Could not load elevation data.',
    );
  }

  const parsed = responseEnvelope(activityStreamSummaryDTOSchema).safeParse(
    body,
  );
  if (!parsed.success) throw new Error('Could not read elevation data.');
  const entry = parsed.data.data;
  if (response.status === 202) {
    return pendingResult({
      previous: options.previous,
      requestedAgainst: options.observedMetadata,
      metadata: entry.metadata,
      retryAfterMs:
        parseRetryAfterMs(response.headers.get('Retry-After'), now) ??
        DEFAULT_PENDING_RETRY_MS,
      now,
    });
  }

  const profile = toElevationProfile(entry);
  return {
    profile,
    metadata: entry.metadata,
    requestedAgainst: options.observedMetadata ?? null,
    status: profile ? 'ready' : 'unavailable',
    message: null,
    retryAt: null,
    pollStartedAt: now,
    pollAttempts: 1,
  };
}

export async function fetchStoredStreamSummaryBatch(options: {
  activityIds: string[];
  userId: string;
  signal: AbortSignal;
  observedMetadata?: ReadonlyMap<string, StreamMetadata | undefined>;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<Map<string, StreamSummaryResult>> {
  const ids = [...new Set(options.activityIds)].slice(
    0,
    STREAM_SUMMARY_PREFETCH_BATCH,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now?.() ?? Date.now();
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
  const response = await fetchImpl(
    `/api/v1/stream-summaries?ids=${ids.join(',')}`,
    {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    },
  );
  if (!response.ok) return new Map();
  const parsed = responseEnvelope(activityStreamSummariesDTOSchema).safeParse(
    await response.json(),
  );
  if (!parsed.success) return new Map();
  const entries = new Map(
    parsed.data.data.summaries.map((entry) => [entry.activity_id, entry]),
  );
  const results = new Map<string, StreamSummaryResult>();
  for (const id of ids) {
    const fence = fences.get(id)!;
    if (!isStreamSummaryFenceCurrent(fence)) continue;
    const entry = entries.get(id);
    const requestedAgainst = options.observedMetadata?.get(id) ?? null;
    // Omission can mean that the activity disappeared while this best-effort
    // request was running. Do not cache it: a still-visible chart must remain
    // eligible for its authoritative single-activity demand request.
    if (!entry) continue;
    if (entry.metadata.state !== 'current') continue;
    const profile = toElevationProfile(entry);
    results.set(id, {
      profile,
      metadata: entry.metadata,
      requestedAgainst,
      status: profile ? 'ready' : 'unavailable',
      message: null,
      retryAt: null,
      pollStartedAt: now,
      pollAttempts: 0,
    });
  }
  return results;
}

export async function removeStreamSummaryActivity(
  queryClient: QueryClient,
  userId: string,
  activityId: string,
) {
  fenceStreamSummaryActivity(userId, activityId);
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map, not a database table
  observedMetadata.delete(fenceKey(userId, activityId));
  const queryKey = streamSummaryQueryKey(userId, activityId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.removeQueries({ queryKey, exact: true });
}

export async function reloadStreamSummaryActivity(
  queryClient: QueryClient,
  userId: string,
  activityId: string,
) {
  fenceStreamSummaryActivity(userId, activityId);
  const queryKey = streamSummaryQueryKey(userId, activityId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  // Reset drops invalid data immediately and refetches an active observer.
  // Inactive entries stay empty until a chart requests them again.
  await queryClient.resetQueries({ queryKey, exact: true });
}

export async function removeStreamSummaryScope(
  queryClient: QueryClient,
  userId: string,
) {
  fenceStreamSummaryScope(userId);
  for (const key of observedMetadata.keys()) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map, not a database table
    if (key.startsWith(`${userId}\u0000`)) observedMetadata.delete(key);
  }
  const queryKey = [...STREAM_SUMMARY_QUERY_ROOT, userId];
  await queryClient.cancelQueries({ queryKey });
  queryClient.removeQueries({ queryKey });
}

export async function reloadStreamSummaryScope(
  queryClient: QueryClient,
  userId: string,
) {
  fenceStreamSummaryScope(userId);
  for (const key of observedMetadata.keys()) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map, not a database table
    if (key.startsWith(`${userId}\u0000`)) observedMetadata.delete(key);
  }
  const queryKey = [...STREAM_SUMMARY_QUERY_ROOT, userId];
  await queryClient.cancelQueries({ queryKey });
  await queryClient.resetQueries({ queryKey });
}

export async function reconcileStreamSummaryMetadata(
  queryClient: QueryClient,
  userId: string,
  activityId: string,
  metadata: StreamMetadata | undefined,
) {
  const observedKey = fenceKey(userId, activityId);
  const hadObservation = observedMetadata.has(observedKey);
  const previousMetadata = observedMetadata.get(observedKey);
  observedMetadata.set(observedKey, metadata);
  const metadataChanged =
    hadObservation && !sameMetadata(previousMetadata, metadata);
  const queryKey = streamSummaryQueryKey(userId, activityId);
  const result = queryClient.getQueryData<StreamSummaryResult>(queryKey);
  if (result && !isStreamSummaryResultReusable(result, metadata)) {
    await reloadStreamSummaryActivity(queryClient, userId, activityId);
  } else if (!result && metadataChanged) {
    // A first request has no data cache entry while it is in flight. Fence
    // and reset it so its late response cannot cross this metadata change.
    await reloadStreamSummaryActivity(queryClient, userId, activityId);
  }
}
