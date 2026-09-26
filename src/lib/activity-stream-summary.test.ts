import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as ReactQuery from '@tanstack/react-query';

import { makeEnvelope } from '~/contracts/v1/envelope';
import type {
  ActivityStreamSummaryDTO,
  StreamMetadata,
} from '~/contracts/v1/activity-streams';
import {
  canManuallyRetryStreamSummary,
  captureStreamSummaryFence,
  fenceStreamSummaryActivity,
  fenceStreamSummaryScope,
  fetchActivityStreamSummary,
  fetchStoredStreamSummaryBatch,
  isStreamSummaryCurrent,
  parseRetryAfterMs,
  reconcileStreamSummaryMetadata,
  streamSummaryQueryKey,
  streamSummaryRefetchInterval,
  type FetchLike,
  type StreamSummaryResult,
} from './activity-stream-summary.ts';

// The repository's test command enables the `react-server` condition, under
// which React intentionally has no createContext. Resolve react-query's
// framework-neutral transitive core for a real QueryClient/QueryObserver
// lifecycle test without evaluating its React provider entrypoint.
const require = createRequire(import.meta.url);
const reactQueryPackage = require.resolve('@tanstack/react-query/package.json');
const queryCoreEntry = require.resolve('@tanstack/query-core', {
  paths: [dirname(reactQueryPackage)],
});
const { QueryClient, QueryObserver } = (await import(
  pathToFileURL(queryCoreEntry).href
)) as {
  QueryClient: typeof ReactQuery.QueryClient;
  QueryObserver: typeof ReactQuery.QueryObserver;
};

const NOW = Date.parse('2026-09-26T12:00:00.000Z');

const metadata = (overrides: Partial<StreamMetadata> = {}): StreamMetadata => ({
  generation: 'generation-1',
  revision: '1',
  state: 'current',
  fetch_status: 'succeeded',
  available_types: ['distance', 'altitude'],
  fetched_at: '2026-09-26T11:00:00.000Z',
  expires_at: null,
  ...overrides,
});

const summary = (
  overrides: Partial<ActivityStreamSummaryDTO> = {},
): ActivityStreamSummaryDTO => ({
  activity_id: '42',
  metadata: metadata(),
  summary: {
    version: 1,
    basis: 'distance',
    distance: [0, 100, 200],
    altitude: [500, 520, 510],
  },
  last_error: null,
  next_retry_at: null,
  ...overrides,
});

const success = (
  entry: ActivityStreamSummaryDTO,
  options: { status?: number; retryAfter?: string } = {},
) =>
  Response.json(makeEnvelope(entry, new Date(NOW)), {
    status: options.status ?? 200,
    headers: options.retryAfter
      ? { 'Retry-After': options.retryAfter }
      : undefined,
  });

const apiError = (status: number, retryable: boolean, retryAfter?: string) =>
  Response.json(
    {
      error: {
        code: status === 429 ? 'rate_limited' : 'streams_fetch_failed',
        message: 'Try later.',
        retryable,
        requestId: 'request-1',
      },
    },
    {
      status,
      headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
    },
  );

void test('Retry-After preserves delays over 30 seconds and accepts HTTP dates', async () => {
  assert.equal(parseRetryAfterMs('90', NOW), 90_000);
  assert.equal(
    parseRetryAfterMs('Sat, 26 Sep 2026 12:02:00 GMT', NOW),
    120_000,
  );

  const result = await fetchActivityStreamSummary({
    activityId: '42',
    userId: 'retry-user',
    signal: new AbortController().signal,
    fetchImpl: async () =>
      success(summary(), { status: 202, retryAfter: '90' }),
    now: () => NOW,
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.retryAt, NOW + 90_000);
});

void test('Retry-After delta seconds starts after a delayed response arrives', async () => {
  let clock = NOW;
  let resolveResponse!: (response: Response) => void;
  const request = fetchActivityStreamSummary({
    activityId: '42',
    userId: 'delayed-retry-user',
    signal: new AbortController().signal,
    fetchImpl: () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    now: () => clock,
  });

  clock += 30_000;
  resolveResponse(success(summary(), { status: 202, retryAfter: '90' }));
  const result = await request;
  assert.equal(result.retryAt, NOW + 120_000);
});

void test('retryable 429 and 503 responses remain eligible for bounded polling', async () => {
  for (const status of [429, 503]) {
    const result = await fetchActivityStreamSummary({
      activityId: String(status),
      userId: 'errors-user',
      signal: new AbortController().signal,
      fetchImpl: async () => apiError(status, true, '75'),
      now: () => NOW,
    });
    assert.equal(result.status, 'pending');
    assert.equal(result.retryAt, NOW + 75_000);
  }

  for (const [status, message] of [
    [429, /rate limited/i],
    [503, /temporarily unavailable/i],
  ] as const) {
    const bounded = await fetchActivityStreamSummary({
      activityId: `${status}-long`,
      userId: 'errors-user',
      signal: new AbortController().signal,
      fetchImpl: async () => apiError(status, true, '601'),
      now: () => NOW,
    });
    assert.equal(bounded.status, 'paused');
    assert.equal(bounded.retryAt, NOW + 601_000);
    assert.match(bounded.message!, message);
    assert.equal(streamSummaryRefetchInterval(bounded, NOW), false);
    assert.equal(canManuallyRetryStreamSummary(bounded, NOW + 600_999), false);
    assert.equal(canManuallyRetryStreamSummary(bounded, NOW + 601_000), true);
  }

  await assert.rejects(
    fetchActivityStreamSummary({
      activityId: '503-terminal',
      userId: 'errors-user',
      signal: new AbortController().signal,
      fetchImpl: async () => apiError(503, false, '75'),
      now: () => NOW,
    }),
    /Try later/,
  );
});

void test('non-JSON 429/503 responses use status and Retry-After unless JSON explicitly disables retry', async () => {
  for (const status of [429, 503]) {
    const result = await fetchActivityStreamSummary({
      activityId: `plain-${status}`,
      userId: 'plain-error-user',
      signal: new AbortController().signal,
      fetchImpl: async () =>
        new Response('<html>temporary proxy response</html>', {
          status,
          headers: {
            'Content-Type': 'text/html',
            'Retry-After': '95',
          },
        }),
      now: () => NOW,
    });
    assert.equal(result.status, 'pending');
    assert.equal(result.retryAt, NOW + 95_000);
    assert.match(
      result.message!,
      status === 429 ? /rate limited/i : /temporarily unavailable/i,
    );
  }

  await assert.rejects(
    fetchActivityStreamSummary({
      activityId: 'explicit-terminal',
      userId: 'plain-error-user',
      signal: new AbortController().signal,
      fetchImpl: async () => apiError(503, false, '95'),
      now: () => NOW,
    }),
    /Try later/,
  );
});

void test('unavailable summaries are terminal while omitted batch entries remain demand eligible', async () => {
  const unavailable = await fetchActivityStreamSummary({
    activityId: '42',
    userId: 'unavailable-user',
    signal: new AbortController().signal,
    fetchImpl: async () =>
      success(
        summary({
          summary: { version: 1, basis: null },
        }),
      ),
    now: () => NOW,
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.retryAt, null);

  const batch = await fetchStoredStreamSummaryBatch({
    activityIds: ['42', '42', '43'],
    userId: 'batch-user',
    signal: new AbortController().signal,
    fetchImpl: async (input) => {
      assert.match(input, /ids=42,43$/);
      return Response.json(
        makeEnvelope({ summaries: [summary()] }, new Date(NOW)),
      );
    },
    now: () => NOW,
  });
  assert.equal(batch.get('42')?.status, 'ready');
  assert.equal(batch.has('43'), false);
});

void test('stored-only summary requests deduplicate and never exceed 100 IDs', async () => {
  const ids = Array.from({ length: 105 }, (_, index) => String(index + 1));
  ids.push('1');
  await fetchStoredStreamSummaryBatch({
    activityIds: ids,
    userId: 'bounded-batch-user',
    signal: new AbortController().signal,
    fetchImpl: async (input) => {
      const requested = new URL(input, 'https://example.test').searchParams
        .get('ids')!
        .split(',');
      assert.equal(requested.length, 100);
      assert.equal(new Set(requested).size, 100);
      return Response.json(
        makeEnvelope({ summaries: [] }, new Date(NOW)),
      );
    },
    now: () => NOW,
  });
});

void test('pending reopen scheduling waits until Retry-After and never disables an overdue poll', () => {
  const pending: StreamSummaryResult = {
    profile: null,
    metadata: metadata({ state: 'not_fetched', fetch_status: 'pending' }),
    requestedAgainst: metadata({ state: 'not_fetched' }),
    status: 'pending',
    message: null,
    retryAt: NOW + 90_000,
    pollStartedAt: NOW,
    pollAttempts: 1,
  };
  assert.equal(streamSummaryRefetchInterval(pending, NOW), 90_000);
  assert.equal(streamSummaryRefetchInterval(pending, NOW + 90_001), 1);
});

void test('same-generation direct data beats delayed older sync metadata but newer revisions invalidate it', () => {
  const requestedAgainst = metadata({ revision: '1' });
  const result: StreamSummaryResult = {
    profile: { distance: [0, 1], altitude: [5, 6] },
    metadata: metadata({ revision: '3' }),
    requestedAgainst,
    status: 'ready',
    message: null,
    retryAt: null,
    pollStartedAt: NOW,
    pollAttempts: 1,
  };
  assert.equal(isStreamSummaryCurrent(result, requestedAgainst), true);
  assert.equal(
    isStreamSummaryCurrent(result, metadata({ revision: '2' })),
    true,
  );
  assert.equal(
    isStreamSummaryCurrent(result, metadata({ revision: '4' })),
    false,
  );
  assert.equal(
    isStreamSummaryCurrent(
      result,
      metadata({ generation: 'generation-2', revision: '1' }),
    ),
    false,
  );
});

void test('late direct responses are fenced after activity deletion and account reset', async () => {
  let resolveDelete!: (response: Response) => void;
  const deleteFetch: FetchLike = () =>
    new Promise((resolve) => {
      resolveDelete = resolve;
    });
  const deleted = fetchActivityStreamSummary({
    activityId: '42',
    userId: 'delete-user',
    signal: new AbortController().signal,
    fetchImpl: deleteFetch,
    now: () => NOW,
  });
  const deletionFence = captureStreamSummaryFence('delete-user', '42');
  fenceStreamSummaryActivity('delete-user', '42');
  assert.equal(
    deletionFence.activity + 1,
    captureStreamSummaryFence('delete-user', '42').activity,
  );
  resolveDelete(success(summary()));
  await assert.rejects(deleted, { name: 'AbortError' });

  let resolveLogout!: (response: Response) => void;
  const logout = fetchActivityStreamSummary({
    activityId: '42',
    userId: 'logout-user',
    signal: new AbortController().signal,
    fetchImpl: () =>
      new Promise((resolve) => {
        resolveLogout = resolve;
      }),
    now: () => NOW,
  });
  fenceStreamSummaryScope('logout-user');
  resolveLogout(success(summary()));
  await assert.rejects(logout, { name: 'AbortError' });
});

void test('metadata reconciliation preserves matching pending/unavailable states', async () => {
  const queryClient = new QueryClient();
  const userId = 'settled-user';
  const activityId = '42';
  const observed = metadata({ state: 'not_fetched', fetch_status: 'pending' });
  const pending: StreamSummaryResult = {
    profile: null,
    metadata: observed,
    requestedAgainst: observed,
    status: 'pending',
    message: null,
    retryAt: NOW + 90_000,
    pollStartedAt: NOW,
    pollAttempts: 1,
  };
  const key = streamSummaryQueryKey(userId, activityId);
  queryClient.setQueryData(key, pending);

  await reconcileStreamSummaryMetadata(
    queryClient,
    userId,
    activityId,
    observed,
  );
  assert.deepEqual(queryClient.getQueryData(key), pending);

  const unavailable = { ...pending, status: 'unavailable' as const };
  queryClient.setQueryData(key, unavailable);
  await reconcileStreamSummaryMetadata(
    queryClient,
    userId,
    activityId,
    observed,
  );
  assert.deepEqual(queryClient.getQueryData(key), unavailable);
});

void test('metadata invalidation resets and reloads a mounted query observer', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const userId = 'observer-user';
  const activityId = '42';
  const oldMetadata = metadata({ generation: 'old', revision: '2' });
  const newMetadata = metadata({ generation: 'new', revision: '1' });
  const oldResult: StreamSummaryResult = {
    profile: { distance: [0, 1], altitude: [5, 6] },
    metadata: oldMetadata,
    requestedAgainst: oldMetadata,
    status: 'ready',
    message: null,
    retryAt: null,
    pollStartedAt: NOW,
    pollAttempts: 1,
  };
  const newResult: StreamSummaryResult = {
    ...oldResult,
    metadata: newMetadata,
    requestedAgainst: newMetadata,
  };
  const queryKey = streamSummaryQueryKey(userId, activityId);
  queryClient.setQueryData(queryKey, oldResult);
  let requests = 0;
  let resolveRefetch!: (value: StreamSummaryResult) => void;
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: () => {
      requests += 1;
      return new Promise<StreamSummaryResult>((resolve) => {
        resolveRefetch = resolve;
      });
    },
    staleTime: Infinity,
  });
  let publish!: () => void;
  const published = new Promise<void>((resolve) => {
    publish = resolve;
  });
  const unsubscribe = observer.subscribe((state) => {
    if (state.data?.metadata?.generation === 'new') publish();
  });

  await reconcileStreamSummaryMetadata(
    queryClient,
    userId,
    activityId,
    newMetadata,
  );

  assert.equal(requests, 1);
  assert.equal(queryClient.getQueryData(queryKey), undefined);

  resolveRefetch(newResult);
  await published;
  assert.equal(
    queryClient.getQueryData<StreamSummaryResult>(queryKey)?.metadata
      ?.generation,
    'new',
  );
  unsubscribe();
});

void test('metadata change fences an in-flight first request with no cached data', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const userId = 'in-flight-observer-user';
  const activityId = '42';
  const oldMetadata = metadata({ generation: 'old', revision: '2' });
  const newMetadata = metadata({ generation: 'new', revision: '1' });
  const result = (source: StreamMetadata): StreamSummaryResult => ({
    profile: { distance: [0, 1], altitude: [5, 6] },
    metadata: source,
    requestedAgainst: source,
    status: 'ready',
    message: null,
    retryAt: null,
    pollStartedAt: NOW,
    pollAttempts: 1,
  });
  const queryKey = streamSummaryQueryKey(userId, activityId);
  await reconcileStreamSummaryMetadata(
    queryClient,
    userId,
    activityId,
    oldMetadata,
  );

  let resolveFirst!: (value: StreamSummaryResult) => void;
  let requests = 0;
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: () => {
      requests += 1;
      if (requests === 1) {
        return new Promise<StreamSummaryResult>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(result(newMetadata));
    },
    staleTime: Infinity,
  });
  let publish!: () => void;
  const published = new Promise<void>((resolve) => {
    publish = resolve;
  });
  const unsubscribe = observer.subscribe((state) => {
    if (state.data?.metadata?.generation === 'new') publish();
  });
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.equal(queryClient.getQueryData(queryKey), undefined);

  await reconcileStreamSummaryMetadata(
    queryClient,
    userId,
    activityId,
    newMetadata,
  );
  assert.equal(requests, 2);
  await published;
  assert.equal(
    queryClient.getQueryData<StreamSummaryResult>(queryKey)?.metadata
      ?.generation,
    'new',
  );

  resolveFirst(result(oldMetadata));
  await Promise.resolve();
  assert.equal(
    queryClient.getQueryData<StreamSummaryResult>(queryKey)?.metadata
      ?.generation,
    'new',
  );
  unsubscribe();
});
