import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import { RAW_STREAMS_FIXTURE } from './streams.fixture';
import {
  describeActivityStreams,
  rawActivityStreamsSchema,
  streamActivityIdSchema,
} from './streams';
import {
  StravaApiError,
  StravaClient,
  type StravaRateLimitUsage,
} from './client';

void test('raw samples, missing streams, irregular timing and metadata are preserved', () => {
  const parsed = rawActivityStreamsSchema.parse(RAW_STREAMS_FIXTURE);
  assert.deepEqual(parsed, RAW_STREAMS_FIXTURE);
  assert.deepEqual(describeActivityStreams(parsed), {
    availableTypes: [
      'time',
      'distance',
      'latlng',
      'altitude',
      'watts',
      'heartrate',
    ],
    sampleCounts: {
      time: 4,
      distance: 4,
      latlng: 4,
      altitude: 4,
      watts: 4,
      heartrate: 3,
    },
    matchingLengths: false,
    matchingSampling: false,
  });
  assert.deepEqual(rawActivityStreamsSchema.parse({}), {});
  const partial = { time: { ...RAW_STREAMS_FIXTURE.time, data: [] } };
  assert.deepEqual(rawActivityStreamsSchema.parse(partial), partial);
  assert.equal('watts' in rawActivityStreamsSchema.parse(partial), false);
});

void test('malformed streams fail as a whole, without coercion or silent truncation', () => {
  for (const invalid of [
    null,
    [],
    { unknown: {} },
    { time: { ...RAW_STREAMS_FIXTURE.time, data: ['1'] } },
    { time: { ...RAW_STREAMS_FIXTURE.time, data: [1.25] } },
    { time: { ...RAW_STREAMS_FIXTURE.time, original_size: 1 } },
    { altitude: { ...RAW_STREAMS_FIXTURE.altitude, data: [Infinity] } },
    { watts: { ...RAW_STREAMS_FIXTURE.watts, type: 'time' } },
    { heartrate: { data: [120] } },
    { latlng: { ...RAW_STREAMS_FIXTURE.latlng, data: [[47, 8, 0]] } },
    { latlng: { ...RAW_STREAMS_FIXTURE.latlng, data: [[91, 8]] } },
  ])
    assert.throws(() => rawActivityStreamsSchema.parse(invalid), ZodError);
});

void test('activity IDs retain full bigint precision and reject unsafe inputs', () => {
  for (const id of ['1', '9007199254740993', '9223372036854775807'])
    assert.equal(streamActivityIdSchema.parse(id), id);
  for (const id of [
    1,
    '0',
    '-1',
    '01',
    '1e3',
    '9223372036854775808',
    '../2',
    '',
  ]) {
    assert.throws(() => streamActivityIdSchema.parse(id), ZodError);
  }
});

void test('client requests all six keys once, authenticates, validates and reports limits', async (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    AUTH_STRAVA_ID: 'fixture-id',
    AUTH_STRAVA_SECRET: 'fixture-secret',
    ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
  });
  t.after(() => {
    process.env = originalEnv;
  });
  const usages: StravaRateLimitUsage[] = [];
  let calls = 0;
  const mockFetch = t.mock.method(
    globalThis,
    'fetch',
    async (input: string, init?: RequestInit) => {
      calls++;
      const url = new URL(input);
      assert.equal(url.pathname, '/api/v3/activities/9007199254740993/streams');
      assert.equal(
        url.searchParams.get('keys'),
        'time,distance,latlng,altitude,watts,heartrate',
      );
      assert.equal(url.searchParams.get('key_by_type'), 'true');
      assert.equal(url.searchParams.has('resolution'), false);
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer fixture-access',
      );
      return Response.json(RAW_STREAMS_FIXTURE, {
        headers: {
          'x-readratelimit-limit': '100,1000',
          'x-readratelimit-usage': '9,100',
        },
      });
    },
  );
  const client = StravaClient.withAccessToken('fixture-access', {
    onRateLimit: (usage) => usages.push(usage),
    requestBudget: testBudget,
  });
  assert.deepEqual(
    await client.getActivityStreams('9007199254740993'),
    RAW_STREAMS_FIXTURE,
  );
  assert.equal(calls, 1);
  assert.equal(usages[0]?.read?.usageDaily, 100);
  mockFetch.mock.mockImplementation(async () =>
    Response.json({ message: 'Too many requests' }, { status: 429 }),
  );
  await assert.rejects(
    client.getActivityStreams('1'),
    (error: unknown) => error instanceof StravaApiError && error.status === 429,
  );
  mockFetch.mock.mockImplementation(async () =>
    Response.json({ time: { data: [1] } }),
  );
  await assert.rejects(client.getActivityStreams('1'), ZodError);
  mockFetch.mock.mockImplementation(async () => Response.json({}));
  assert.deepEqual(await client.getActivityStreams('1'), {});
});

const testBudget = {
  async reserve(read: boolean) {
    return { startedAt: new Date(), read };
  },
  async observe() {
    return undefined;
  },
};
