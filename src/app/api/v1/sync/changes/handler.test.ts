import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import { syncChangesPageDTOSchema } from '~/contracts/v1/sync.ts';
import { encodeSyncCursor } from '~/server/sync/cursor.ts';
import type { Activity, Photo, SyncChange } from '~/server/db/schema.ts';
import type { Actor } from '~/server/auth/actor.ts';
import { createSyncChangesHandler } from './handler.ts';

const now = new Date('2026-09-20T12:00:00.000Z');
const ACTOR: Actor = { userId: 'user-1', athleteId: 42, authentication: 'cookie' };

function buildActivity(overrides: Partial<Activity> & { id: number }): Activity {
  return {
    athlete: ACTOR.athleteId,
    public_id: overrides.id * 7,
    name: `Activity ${overrides.id}`,
    description: null,
    distance: null,
    moving_time: null,
    elapsed_time: null,
    total_elevation_gain: null,
    sport_type: 'Run',
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    start_date_local: new Date('2026-01-01T00:00:00.000Z'),
    timezone: 'UTC',
    start_latlng: null,
    end_latlng: null,
    achievement_count: null,
    kudos_count: null,
    comment_count: null,
    athlete_count: null,
    photo_count: null,
    total_photo_count: null,
    map_id: null,
    map_polyline: null,
    map_summary_polyline: null,
    map_bbox: null,
    trainer: null,
    commute: null,
    manual: null,
    private: null,
    flagged: null,
    workout_type: null,
    upload_id: null,
    average_speed: null,
    max_speed: null,
    calories: null,
    has_heartrate: null,
    average_heartrate: null,
    max_heartrate: null,
    heartrate_opt_out: null,
    display_hide_heartrate_option: null,
    elev_high: null,
    elev_low: null,
    pr_count: null,
    has_kudoed: null,
    hide_from_home: null,
    gear_id: null,
    device_watts: null,
    average_watts: null,
    max_watts: null,
    weighted_average_watts: null,
    kilojoules: null,
    last_updated: new Date('2026-01-01T00:00:00.000Z'),
    is_complete: false,
    ...overrides,
  };
}

function buildPhoto(overrides: Partial<Photo> & { unique_id: string }): Photo {
  return {
    activity_id: 1,
    athlete_id: ACTOR.athleteId,
    activity_name: null,
    caption: null,
    type: 0,
    source: null,
    urls: null,
    sizes: null,
    default_photo: null,
    location: null,
    uploaded_at: null,
    created_at: null,
    post_id: null,
    status: null,
    resource_state: null,
    ...overrides,
  };
}

function buildChange(overrides: Partial<SyncChange> & { sequence: number }): SyncChange {
  return {
    athleteId: ACTOR.athleteId,
    entityType: 'activity',
    entityId: '1',
    operation: 'upsert',
    changedAt: now,
    ...overrides,
  };
}

function fakeActivitiesRepo(rows: Activity[]) {
  return {
    async findManyByIds(ids: number[]) {
      const idSet = new Set(ids);
      return rows.filter((row) => idSet.has(row.id));
    },
  };
}

function fakePhotosRepo(rows: Photo[]) {
  return {
    async findManyByIds(ids: string[]) {
      const idSet = new Set(ids);
      return rows.filter((row) => idSet.has(row.unique_id));
    },
  };
}

function fakeChangesRepo(opts: { changes: SyncChange[]; retained?: boolean }) {
  return {
    async findAfter(athleteId: number, afterSequence: number, { limit = 500 }: { limit?: number } = {}) {
      return opts.changes
        .filter((c) => c.athleteId === athleteId && c.sequence > afterSequence)
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, limit);
    },
    async isCursorRetained() {
      return opts.retained ?? true;
    },
  };
}

void test('GET /api/v1/sync/changes returns 401 without an actor', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => null,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [] }),
  });

  const response = await GET(new Request('https://example.test/api/v1/sync/changes?cursor=x'));
  assert.equal(response.status, 401);
});

void test('GET /api/v1/sync/changes requires a cursor', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [] }),
  });

  const response = await GET(new Request('https://example.test/api/v1/sync/changes'));
  const body: unknown = await response.json();

  assert.equal(response.status, 400);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('GET /api/v1/sync/changes returns 409 sync_rebootstrap_required for a malformed cursor', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [] }),
  });

  const response = await GET(
    new Request('https://example.test/api/v1/sync/changes?cursor=garbage'),
  );
  const body = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'sync_rebootstrap_required');
});

void test('GET /api/v1/sync/changes returns 409 sync_rebootstrap_required when the cursor is no longer retained', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [], retained: false }),
  });

  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encodeSyncCursor(3))}`,
    ),
  );
  const body = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'sync_rebootstrap_required');
});

void test('GET /api/v1/sync/changes returns ordered upserts and tombstones after the cursor', async () => {
  const activity = buildActivity({ id: 1 });
  const photo = buildPhoto({ unique_id: 'p1' });
  const changes = [
    buildChange({ sequence: 1, entityType: 'activity', entityId: '1', operation: 'upsert' }),
    buildChange({ sequence: 2, entityType: 'photo', entityId: 'p1', operation: 'upsert' }),
    buildChange({ sequence: 3, entityType: 'activity', entityId: '2', operation: 'delete' }),
  ];
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([activity]),
    photosRepo: fakePhotosRepo([photo]),
    changesRepo: fakeChangesRepo({ changes }),
  });

  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encodeSyncCursor(0))}`,
    ),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(responseEnvelope(syncChangesPageDTOSchema).safeParse(body).success, true);

  const data = (
    body as {
      data: {
        items: { entityType: string; operation: string; id: string; activity?: unknown; photo?: unknown }[];
        nextCursor: string;
      };
    }
  ).data;
  assert.deepEqual(
    data.items.map((i) => [i.entityType, i.operation, i.id]),
    [
      ['activity', 'upsert', '1'],
      ['photo', 'upsert', 'p1'],
      ['activity', 'delete', '2'],
    ],
  );
  assert.ok(data.items[0]?.activity, 'an activity upsert must include the current activity DTO');
  assert.ok(data.items[1]?.photo, 'a photo upsert must include the current photo DTO');
});

void test('GET /api/v1/sync/changes drops an upsert whose current row is already gone (a later delete supersedes it)', async () => {
  const changes = [
    buildChange({ sequence: 1, entityType: 'activity', entityId: '99', operation: 'upsert' }),
  ];
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    // Row 99 no longer exists (already deleted since this change record was written).
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes }),
  });

  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encodeSyncCursor(0))}`,
    ),
  );
  const body = (await response.json()) as { data: { items: unknown[]; nextCursor: string } };

  assert.deepEqual(body.data.items, []);
  // The cursor still advances past the dropped change, so it is never re-delivered.
  assert.equal(body.data.nextCursor, encodeSyncCursor(1));
});

void test('GET /api/v1/sync/changes returns the same cursor back when there is nothing new (poll, do not error)', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [] }),
  });

  const cursor = encodeSyncCursor(5);
  const response = await GET(
    new Request(`https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(cursor)}`),
  );
  const body = (await response.json()) as { data: { items: unknown[]; nextCursor: string } };

  assert.deepEqual(body.data.items, []);
  assert.equal(body.data.nextCursor, cursor);
});

void test('GET /api/v1/sync/changes replaying the same page is idempotent (same input cursor -> same output)', async () => {
  const activity = buildActivity({ id: 1 });
  const changes = [buildChange({ sequence: 1, entityType: 'activity', entityId: '1', operation: 'upsert' })];
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([activity]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes }),
  });

  const cursor = encodeSyncCursor(0);
  const first = await GET(new Request(`https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(cursor)}`));
  const second = await GET(new Request(`https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(cursor)}`));

  assert.deepEqual(await first.json(), await second.json());
});
