import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityDTO } from '~/contracts/v1/activity';
import type {
  ActivityCompactStreamSummaryDTO,
  StreamMetadata,
} from '~/contracts/v1/activity-streams';
import { makeEnvelope } from '~/contracts/v1/envelope';
import {
  fenceStreamSummaryScope,
  StreamSummaryBatchError,
  mergeStoredStreamSummaryResult,
} from '~/lib/activity-stream-summary';
import { encodeStreamSummary } from '~/lib/streams/compact-summary';
import {
  canReuseCachedStreamSummary,
  type CachedStreamSummary,
} from '~/lib/streams/summary-cache-record';
import {
  loadActivityStreamSummary,
  syncStoredStreamSummaries,
  type StreamSummaryStore,
} from './stream-summary-sync';

const metadata = (revision = '1'): StreamMetadata => ({
  generation: 'one',
  revision,
  state: 'current',
  fetch_status: 'succeeded',
  available_types: ['distance', 'altitude'],
  fetched_at: '2026-10-01T10:00:00Z',
  expires_at: null,
});
const activity = (id: string, streams = metadata()): ActivityDTO =>
  ({
    id,
    streams,
    start_date: new Date(Date.UTC(2026, 0, Number(id))).toISOString(),
  }) as ActivityDTO;
const entry = (
  id: string,
  overrides: Partial<ActivityCompactStreamSummaryDTO> = {},
): ActivityCompactStreamSummaryDTO => ({
  activity_id: id,
  metadata: metadata(),
  last_error: null,
  next_retry_at: null,
  summary: encodeStreamSummary({
    version: 1,
    basis: 'distance',
    distance: [0, 100],
    altitude: [1, 2],
  }),
  ...overrides,
});
const batchResponse = (summaries: ActivityCompactStreamSummaryDTO[]) =>
  Response.json(makeEnvelope({ summaries }));
function memoryStore(activities: ActivityDTO[]) {
  const records = new Map<string, CachedStreamSummary>();
  const store: StreamSummaryStore = {
    getCachedActivityDTOs: async () => activities,
    getCachedStreamSummaries: async (_scope, ids) =>
      new Map(
        ids.flatMap((id) => (records.has(id) ? [[id, records.get(id)!]] : [])),
      ),
    putCachedStreamSummaries: async (_scope, values, isCurrent) => {
      for (const record of values)
        if (isCurrent(record.data.activity_id))
          records.set(record.data.activity_id, record);
    },
  };
  return { store, records };
}
const signal = () => new AbortController().signal;

void test('existing libraries catch up newest first in <=100 stored-only batches and warm sync uses no network', async () => {
  const activities = Array.from({ length: 205 }, (_, index) =>
    activity(String(index + 1)),
  );
  activities.push(activity('206', { ...metadata(), state: 'not_fetched' }));
  const { store, records } = memoryStore(activities);
  const requests: string[][] = [];
  const fetchImpl = async (url: string) => {
    assert.ok(url.startsWith('/api/v1/stream-summaries/compact?ids='));
    const ids = new URL(url, 'https://example.test').searchParams
      .get('ids')!
      .split(',');
    requests.push(ids);
    return batchResponse(ids.map((id) => entry(id)));
  };
  await syncStoredStreamSummaries({
    userId: 'existing',
    signal: signal(),
    store,
    fetchImpl,
  });
  assert.deepEqual(
    requests.map((ids) => ids.length),
    [100, 100, 5],
  );
  assert.equal(requests[0]![0], '205');
  assert.equal(records.size, 205);
  assert.equal(typeof records.get('1')!.data.summary!.altitude, 'string');
  await syncStoredStreamSummaries({
    userId: 'existing',
    signal: signal(),
    store,
    fetchImpl,
  });
  assert.equal(requests.length, 3);
});

void test('a persisted profile opens offline; a newer revision loads and persists the authoritative demand response', async () => {
  const { store, records } = memoryStore([activity('1')]);
  records.set('1', { data: entry('1'), requestedAgainst: metadata() });
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return Response.json(makeEnvelope(entry('1', { metadata: metadata('2') })));
  };
  const cached = await loadActivityStreamSummary({
    userId: 'offline',
    activityId: '1',
    observedMetadata: metadata(),
    signal: signal(),
    store,
    fetchImpl,
  });
  assert.equal(cached.status, 'ready');
  assert.equal(calls, 0);
  const refreshed = await loadActivityStreamSummary({
    userId: 'offline',
    activityId: '1',
    observedMetadata: metadata('2'),
    signal: signal(),
    store,
    fetchImpl,
  });
  assert.equal(refreshed.metadata!.revision, '2');
  assert.equal(records.get('1')!.data.metadata.revision, '2');
  assert.equal(calls, 1);
});

void test('valid time-only summaries are durable without a profile; null/omitted summaries retry with metadata-sensitive cooldown', async () => {
  const activities = [activity('1'), activity('2'), activity('3')];
  const { store, records } = memoryStore(activities);
  let now = 0;
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return batchResponse([
      entry('1', {
        summary: encodeStreamSummary({
          version: 1,
          basis: 'time',
          time: [0, 10],
        }),
      }),
      entry('2', { summary: null }),
    ]);
  };
  const options = {
    userId: 'misses',
    signal: signal(),
    store,
    fetchImpl,
    now: () => now,
  };
  await syncStoredStreamSummaries(options);
  assert.equal(records.size, 1);
  const cached = await loadActivityStreamSummary({
    userId: 'misses',
    activityId: '1',
    observedMetadata: metadata(),
    signal: signal(),
    store,
    fetchImpl,
  });
  assert.equal(cached.status, 'unavailable');
  await syncStoredStreamSummaries(options);
  assert.equal(calls, 1);
  activities[1]!.streams = metadata('2');
  await syncStoredStreamSummaries(options);
  assert.equal(calls, 2);
  now = 15 * 60_000;
  await syncStoredStreamSummaries(options);
  assert.equal(calls, 3);
});

void test('cancellation keeps completed batches and retry only requests remaining records', async () => {
  const { store, records } = memoryStore(
    Array.from({ length: 150 }, (_, i) => activity(String(i + 1))),
  );
  const controller = new AbortController();
  let calls = 0;
  const fetchImpl = async (url: string) => {
    calls++;
    return batchResponse(
      new URL(url, 'https://example.test').searchParams
        .get('ids')!
        .split(',')
        .map((id) => entry(id)),
    );
  };
  await assert.rejects(
    syncStoredStreamSummaries({
      userId: 'cancel',
      signal: controller.signal,
      store,
      fetchImpl,
      onResults: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.equal(records.size, 100);
  await syncStoredStreamSummaries({
    userId: 'cancel',
    signal: signal(),
    store,
    fetchImpl,
  });
  assert.equal(records.size, 150);
  assert.equal(calls, 2);
});

void test('logout during a disk read prevents hydration and demand fallback', async () => {
  const { store } = memoryStore([activity('1')]);
  const fencedStore = {
    ...store,
    getCachedStreamSummaries: async () => {
      fenceStreamSummaryScope('read-fence');
      return new Map([
        ['1', { data: entry('1'), requestedAgainst: metadata() }],
      ]);
    },
  };
  await assert.rejects(
    loadActivityStreamSummary({
      userId: 'read-fence',
      activityId: '1',
      signal: signal(),
      store: fencedStore,
      fetchImpl: async () => {
        throw new Error('must not fetch');
      },
    }),
    { name: 'AbortError' },
  );
});

void test('a stored batch finishing after a newer demand result cannot roll the chart back', async () => {
  const { store } = memoryStore([activity('1')]);
  const options = {
    userId: 'merge',
    activityId: '1',
    signal: signal(),
    store,
    observedMetadata: metadata(),
  };
  const older = await loadActivityStreamSummary({
    ...options,
    fetchImpl: async () => Response.json(makeEnvelope(entry('1'))),
  });
  const newer = { ...older, metadata: metadata('2') };
  assert.equal(mergeStoredStreamSummaryResult(newer, older), newer);
  const changed = {
    ...older,
    metadata: metadata('3'),
    requestedAgainst: metadata('3'),
  };
  assert.equal(mergeStoredStreamSummaryResult(newer, changed), changed);
  assert.equal(
    mergeStoredStreamSummaryResult(
      { ...older, summary: null, status: 'unavailable' },
      older,
    ),
    older,
  );
  assert.equal(
    mergeStoredStreamSummaryResult(
      { ...older, summary: null, status: 'pending' },
      older,
    ),
    older,
  );
});

void test('background requests stop on HTTP failure and preserve Retry-After', async () => {
  const { store } = memoryStore([activity('1')]);
  await assert.rejects(
    syncStoredStreamSummaries({
      userId: 'rate-limit',
      signal: signal(),
      store,
      now: () => 1000,
      fetchImpl: async () =>
        new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
    }),
    (error) =>
      error instanceof StreamSummaryBatchError &&
      error.status === 429 &&
      error.retryAt === 121_000,
  );
});

void test('stored summary validity rejects stale and changed generations, while direct results may advance observed metadata', () => {
  const record = {
    data: entry('1', { metadata: metadata('2') }),
    requestedAgainst: metadata(),
  };
  assert.equal(canReuseCachedStreamSummary(record, metadata()), true);
  assert.equal(canReuseCachedStreamSummary(record, metadata('3')), false);
  assert.equal(
    canReuseCachedStreamSummary(record, { ...metadata('2'), state: 'stale' }),
    false,
  );
  assert.equal(
    canReuseCachedStreamSummary(record, {
      ...metadata('2'),
      generation: 'other',
    }),
    false,
  );
  assert.equal(
    canReuseCachedStreamSummary(
      { ...record, data: entry('1', { summary: null }) },
      metadata(),
    ),
    false,
  );
});
