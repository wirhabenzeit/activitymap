import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import { syncBootstrapPageDTOSchema } from '~/contracts/v1/sync.ts';
import { decodeSyncCursor } from '~/server/sync/cursor.ts';
import { encodeBootstrapCursor } from '~/server/sync/bootstrap-cursor.ts';
import type { Activity, Photo } from '~/server/db/schema.ts';
import type { Actor } from '~/server/auth/actor.ts';
import { createSyncBootstrapHandler } from './handler.ts';

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

function fakeActivitiesRepo(rows: Activity[]) {
  return {
    async findPageByAthlete(athleteId: number, { afterId = 0, limit }: { afterId?: number; limit: number }) {
      return rows
        .filter((row) => row.athlete === athleteId && row.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
    },
  };
}

function fakePhotosRepo(rows: Photo[]) {
  return {
    async findPageByAthlete(athleteId: number, { afterId = '', limit }: { afterId?: string; limit: number }) {
      return rows
        .filter((row) => row.athlete_id === athleteId && row.unique_id > afterId)
        .sort((a, b) => (a.unique_id < b.unique_id ? -1 : 1))
        .slice(0, limit);
    },
  };
}

function fakeChangesRepo(latestSequence: number) {
  return { async latestSequence() { return latestSequence; } };
}

void test('GET /api/v1/sync/bootstrap returns 401 without an actor', async () => {
  const GET = createSyncBootstrapHandler({
    now: () => now,
    resolveActor: async () => null,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo(0),
  });

  const response = await GET(
    new Request('https://example.test/api/v1/sync/bootstrap'),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 401);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('GET /api/v1/sync/bootstrap first page returns a snapshotCursor at the change-feed high-water mark', async () => {
  const activities = [buildActivity({ id: 1 }), buildActivity({ id: 2 })];
  const GET = createSyncBootstrapHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo(activities),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo(17),
  });

  const response = await GET(
    new Request('https://example.test/api/v1/sync/bootstrap'),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    responseEnvelope(syncBootstrapPageDTOSchema).safeParse(body).success,
    true,
  );
  const data = (body as { data: { snapshotCursor: string | null } }).data;
  assert.ok(data.snapshotCursor);
  assert.deepEqual(decodeSyncCursor(data.snapshotCursor), {
    version: 2,
    sequence: 17,
    athleteId: ACTOR.athleteId,
    issuedAt: now.toISOString(),
  });
});

void test('GET /api/v1/sync/bootstrap does not repeat snapshotCursor on later pages, and paginates activities by keyset, not offset', async () => {
  const activities = [1, 2, 3].map((id) => buildActivity({ id }));
  const activitiesRepo = fakeActivitiesRepo(activities);
  const GET = createSyncBootstrapHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo,
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo(5),
  });

  const first = await GET(
    new Request('https://example.test/api/v1/sync/bootstrap?limit=2'),
  );
  const firstBody = (await first.json()) as {
    data: { items: { id: string }[]; nextCursor: string | null; snapshotCursor: string | null };
  };
  assert.deepEqual(firstBody.data.items.map((i) => i.id), ['1', '2']);
  assert.ok(firstBody.data.nextCursor);
  assert.ok(firstBody.data.snapshotCursor);

  const second = await GET(
    new Request(
      `https://example.test/api/v1/sync/bootstrap?limit=2&cursor=${encodeURIComponent(firstBody.data.nextCursor)}`,
    ),
  );
  const secondBody = (await second.json()) as {
    data: { items: { id: string }[]; nextCursor: string | null; snapshotCursor: string | null };
  };
  assert.deepEqual(secondBody.data.items.map((i) => i.id), ['3']);
  assert.equal(secondBody.data.nextCursor, null, 'exhausted resource must return a null nextCursor');
  assert.equal(
    secondBody.data.snapshotCursor,
    null,
    'snapshotCursor must only be captured on the very first page',
  );
});

void test('GET /api/v1/sync/bootstrap resource=photos paginates independently of activities', async () => {
  const photos = ['a', 'b', 'c'].map((id) => buildPhoto({ unique_id: id }));
  const GET = createSyncBootstrapHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo(photos),
    changesRepo: fakeChangesRepo(0),
  });

  const response = await GET(
    new Request('https://example.test/api/v1/sync/bootstrap?resource=photos&limit=10'),
  );
  const body = (await response.json()) as {
    data: { resource: string; items: { unique_id: string }[]; nextCursor: string | null };
  };

  assert.equal(body.data.resource, 'photos');
  assert.deepEqual(
    body.data.items.map((p) => p.unique_id),
    ['a', 'b', 'c'],
  );
  assert.equal(body.data.nextCursor, null);
});

void test('GET /api/v1/sync/bootstrap resource=photos first page does not mint its own snapshotCursor', async () => {
  // Only `resource=activities` with no `cursor` - the documented start of a
  // bootstrap run - may capture the high-water mark. A `resource=photos`
  // first page must not mint a second, later one.
  const GET = createSyncBootstrapHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([buildPhoto({ unique_id: 'a' })]),
    changesRepo: fakeChangesRepo(9),
  });

  const response = await GET(
    new Request('https://example.test/api/v1/sync/bootstrap?resource=photos'),
  );
  const body = (await response.json()) as { data: { snapshotCursor: string | null } };

  assert.equal(body.data.snapshotCursor, null);
});

void test('GET /api/v1/sync/bootstrap rejects a malformed cursor', async () => {
  const GET = createSyncBootstrapHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo(0),
  });

  const response = await GET(
    new Request('https://example.test/api/v1/sync/bootstrap?cursor=not-a-real-cursor'),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 400);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('GET /api/v1/sync/bootstrap rejects a cursor encoded for the wrong resource', async () => {
  // A photo-resource cursor decodes fine as a bootstrap cursor (both wrap an
  // opaque string key), but using it to resume `resource=activities` with a
  // non-numeric key must fail loudly rather than silently misinterpreting it.
  const GET = createSyncBootstrapHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([buildActivity({ id: 1 })]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo(0),
  });

  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/bootstrap?resource=activities&cursor=${encodeURIComponent(encodeBootstrapCursor('not-a-number'))}`,
    ),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 400);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('GET /api/v1/sync/bootstrap includes retention metadata', async () => {
  const GET = createSyncBootstrapHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo(0),
    retentionDays: 90,
  });

  const response = await GET(
    new Request('https://example.test/api/v1/sync/bootstrap'),
  );
  const body = (await response.json()) as {
    data: { retention: { retentionDays: number; cursorValidUntil: string } };
  };

  assert.equal(body.data.retention.retentionDays, 90);
  assert.equal(
    body.data.retention.cursorValidUntil,
    new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  );
});
