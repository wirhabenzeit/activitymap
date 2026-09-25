import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  activityStreamsDTOSchema,
  toActivityStreamsDTO,
} from './activity-streams';
import { RAW_STREAMS_FIXTURE } from '~/server/strava/streams.fixture';
import type { StreamSnapshot } from '~/server/repositories/activity-streams';
import { STREAM_SOURCE_FIELDS } from '~/server/strava/stream-policy';

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
  summary: null,
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
  );
  assert.deepEqual(full.streams, RAW_STREAMS_FIXTURE);
  assert.equal(full.activity_id, '9007199254740993');
  assert.equal(full.metadata.state, 'current');
  const empty = toActivityStreamsDTO('1', {
    ...streamSnapshotFixture,
    payload: {},
    availableTypes: [],
  });
  assert.deepEqual(empty.streams, {});
  assert.deepEqual(empty.metadata.available_types, []);
  assert.equal(empty.metadata.state, 'current');
  const missing = toActivityStreamsDTO('1', null);
  assert.equal(missing.streams, null);
  assert.equal(missing.metadata.state, 'not_fetched');
  assert.equal(missing.metadata.fetch_status, 'not_fetched');
  assert.ok(activityStreamsDTOSchema.safeParse(full).success);
});
void test('invalidated raw samples are withheld without destroying last-good storage', () => {
  const row = { ...streamSnapshotFixture, invalidatedAt: now };
  const dto = toActivityStreamsDTO('1', row);
  assert.equal(dto.metadata.state, 'stale');
  assert.equal(dto.streams, null);
  assert.equal(dto.metadata.revision, '1');
  assert.deepEqual(row.payload, RAW_STREAMS_FIXTURE);
});
void test('stored samples have no age limit until invalidated', () => {
  // A year-old fetch is still current; only invalidation makes it stale.
  const dto = toActivityStreamsDTO('1', {
    ...streamSnapshotFixture,
    fetchedAt: new Date('2025-01-01T00:00:00Z'),
  });
  assert.equal(dto.metadata.state, 'current');
  assert.equal(dto.metadata.expires_at, null);
  assert.deepEqual(dto.streams, RAW_STREAMS_FIXTURE);
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
