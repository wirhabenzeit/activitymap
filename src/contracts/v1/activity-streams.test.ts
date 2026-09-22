import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  activityStreamsDTOSchema,
  toActivityStreamsDTO,
} from './activity-streams';
import { RAW_STREAMS_FIXTURE } from '~/server/strava/streams.fixture';
import type { StreamSnapshot } from '~/server/repositories/activity-streams';
import {
  STREAM_SOURCE_FIELDS,
  STREAM_MAX_AGE_MS,
} from '~/server/strava/stream-policy';

const now = new Date('2026-09-22T12:00:00Z');
export const streamSnapshotFixture: StreamSnapshot = {
  activityId: '9007199254740993',
  generation: 'generation-1',
  revision: '1',
  availableTypes: [
    'time',
    'distance',
    'latlng',
    'altitude',
    'watts',
    'heartrate',
  ],
  payload: RAW_STREAMS_FIXTURE,
  sourceVersion: 'source-1',
  requestedTypes: [
    'time',
    'distance',
    'latlng',
    'altitude',
    'watts',
    'heartrate',
  ],
  fetchedAt: now,
  lastAttemptAt: now,
  lastAttemptStatus: 'succeeded',
  lastError: null,
  attemptId: null,
  invalidatedAt: null,
  leaseExpiresAt: null,
  nextRetryAt: null,
};
void test('stream wire payload preserves samples and metadata and separates absence from never fetched', () => {
  const full = toActivityStreamsDTO(
    streamSnapshotFixture.activityId,
    streamSnapshotFixture,
    now,
  );
  assert.deepEqual(full.streams, RAW_STREAMS_FIXTURE);
  assert.equal(full.activity_id, '9007199254740993');
  assert.equal(full.metadata.state, 'current');
  const empty = toActivityStreamsDTO(
    '1',
    { ...streamSnapshotFixture, payload: {}, availableTypes: [] },
    now,
  );
  assert.deepEqual(empty.streams, {});
  assert.deepEqual(empty.metadata.available_types, []);
  assert.equal(empty.metadata.state, 'current');
  const missing = toActivityStreamsDTO('1', null, now);
  assert.equal(missing.streams, null);
  assert.equal(missing.metadata.state, 'not_fetched');
  assert.equal(missing.metadata.fetch_status, 'not_fetched');
  assert.ok(activityStreamsDTOSchema.safeParse(full).success);
});
void test('expired and invalidated raw samples are withheld without destroying last-good storage', () => {
  for (const [row, clock] of [
    [streamSnapshotFixture, new Date(now.getTime() + STREAM_MAX_AGE_MS)],
    [{ ...streamSnapshotFixture, invalidatedAt: now }, now],
  ] as const) {
    const dto = toActivityStreamsDTO('1', row, clock);
    assert.equal(dto.metadata.state, 'stale');
    assert.equal(dto.streams, null);
    assert.equal(dto.metadata.revision, '1');
    assert.deepEqual(row.payload, RAW_STREAMS_FIXTURE);
  }
});
void test('SQL invalidation projection tracks the documented source fields', () => {
  const migration = readFileSync(
    new URL(
      '../../../drizzle/0012_stream-lifecycle-triggers.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const fields = [...migration.matchAll(/to_jsonb\(a\)->'([^']+)'/g)].map(
    (entry) => entry[1],
  );
  assert.deepEqual(fields, [...STREAM_SOURCE_FIELDS]);
});
