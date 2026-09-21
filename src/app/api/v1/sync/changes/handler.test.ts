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

function encode(sequence: number, athleteId = ACTOR.athleteId, issuedAt = now) {
  return encodeSyncCursor({ sequence, athleteId, issuedAt });
}

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
    geometryState: 'summary',
    photosState: null,
    lastSummarySeenAt: null,
    lastDetailedFetchedAt: null,
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

function fakeChangesRepo(opts: { changes: SyncChange[]; latestSequence?: number }) {
  return {
    async findAfter(athleteId: number, afterSequence: number, { limit = 500 }: { limit?: number } = {}) {
      return opts.changes
        .filter((c) => c.athleteId === athleteId && c.sequence > afterSequence)
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, limit);
    },
    async latestSequence(athleteId: number) {
      return (
        opts.latestSequence ??
        Math.max(
          0,
          ...opts.changes
            .filter((change) => change.athleteId === athleteId)
            .map((change) => change.sequence),
        )
      );
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

void test('GET /api/v1/sync/changes returns 409 when the cursor retention window has expired', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [] }),
  });

  const expiredAt = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encode(3, ACTOR.athleteId, expiredAt))}`,
    ),
  );
  const body = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'sync_rebootstrap_required');
});

void test('GET /api/v1/sync/changes returns 409 for a cursor issued to another athlete', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [] }),
  });

  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encode(0, 99))}`,
    ),
  );
  const body = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'sync_rebootstrap_required');
});

void test('GET /api/v1/sync/changes offline-expiry boundary: a cursor exactly at the retention deadline is rejected', async () => {
  // "Offline-expiry" for this API (issue #127; #126 removed the legacy
  // offline sync path entirely, so there is no separate offline-mode state
  // to test) is this cursor-retention boundary: how long a client may stay
  // offline before it must rebootstrap rather than resume. `cursorValidUntil`
  // is computed as `issuedAt + retentionDays`, and the handler's own
  // comparison is `now >= cursorValidUntil` - so a client that returns
  // *exactly* on the deadline (not a moment before or after) must already be
  // rejected, not accepted for one more request.
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [] }),
    retentionDays: 90,
  });

  const issuedExactlyAtBoundary = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encode(0, ACTOR.athleteId, issuedExactlyAtBoundary))}`,
    ),
  );
  const body = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'sync_rebootstrap_required');
});

void test('GET /api/v1/sync/changes offline-expiry boundary: a cursor one millisecond inside the retention window is still accepted', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [], latestSequence: 0 }),
    retentionDays: 90,
  });

  const issuedOneMsInsideWindow = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000 + 1);
  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encode(0, ACTOR.athleteId, issuedOneMsInsideWindow))}`,
    ),
  );

  assert.equal(response.status, 200);
});

void test('GET /api/v1/sync/changes returns 409 for a cursor beyond the athlete high-water mark', async () => {
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [], latestSequence: 3 }),
  });

  const response = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encode(4))}`,
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
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encode(0))}`,
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
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(encode(0))}`,
    ),
  );
  const body = (await response.json()) as { data: { items: unknown[]; nextCursor: string } };

  assert.deepEqual(body.data.items, []);
  // The cursor still advances past the dropped change, so it is never re-delivered.
  assert.equal(body.data.nextCursor, encode(1));
});

void test('GET /api/v1/sync/changes returns the same cursor back when there is nothing new (poll, do not error)', async () => {
  const reconciledAt = new Date('2026-09-19T06:00:00.000Z');
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes: [], latestSequence: 5 }),
    freshnessRepo: { lastCompletedAt: async () => reconciledAt },
  });

  const issuedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const cursor = encode(5, ACTOR.athleteId, issuedAt);
  const response = await GET(
    new Request(`https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(cursor)}`),
  );
  const body = (await response.json()) as {
    data: {
      items: unknown[];
      nextCursor: string;
      retention: { cursorValidUntil: string };
      freshness: { lastSummaryReconciledAt: string | null };
    };
  };

  assert.deepEqual(body.data.items, []);
  assert.equal(body.data.nextCursor, cursor);
  assert.equal(
    body.data.retention.cursorValidUntil,
    new Date(issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    'an empty poll must not renew the same cursor beyond its original retention deadline',
  );
  assert.equal(
    body.data.freshness.lastSummaryReconciledAt,
    reconciledAt.toISOString(),
  );
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

  const cursor = encode(0);
  const first = await GET(new Request(`https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(cursor)}`));
  const second = await GET(new Request(`https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(cursor)}`));

  assert.deepEqual(await first.json(), await second.json());
});

void test('GET /api/v1/sync/changes pagination boundary: a page exactly filling the limit is followed by an empty page returning the same cursor back', async () => {
  const limit = 5;
  const changes = Array.from({ length: limit }, (_, i) =>
    buildChange({ sequence: i + 1, entityType: 'activity', entityId: String(i + 1), operation: 'delete' }),
  );
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo([]),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes, latestSequence: limit }),
  });

  const first = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?limit=${limit}&cursor=${encodeURIComponent(encode(0))}`,
    ),
  );
  const firstBody = (await first.json()) as {
    data: { items: unknown[]; nextCursor: string };
  };
  assert.equal(firstBody.data.items.length, limit);
  assert.equal(firstBody.data.nextCursor, encode(limit));

  const second = await GET(
    new Request(
      `https://example.test/api/v1/sync/changes?limit=${limit}&cursor=${encodeURIComponent(firstBody.data.nextCursor)}`,
    ),
  );
  const secondBody = (await second.json()) as {
    data: { items: unknown[]; nextCursor: string };
  };
  assert.deepEqual(secondBody.data.items, []);
  assert.equal(secondBody.data.nextCursor, firstBody.data.nextCursor);
});

void test('GET /api/v1/sync/changes holds up for a large account: thousands of changes paginate completely, in strict sequence order, with no duplicates or gaps', async () => {
  const TOTAL = 4531; // Deliberately not a round number or a multiple of the page size.
  const limit = 250;
  const changes = Array.from({ length: TOTAL }, (_, i) =>
    buildChange({
      sequence: i + 1,
      entityType: 'activity',
      entityId: String((i % 500) + 1),
      operation: i % 7 === 0 ? 'delete' : 'upsert',
    }),
  );
  const activities = Array.from({ length: 500 }, (_, i) => buildActivity({ id: i + 1 }));
  const GET = createSyncChangesHandler({
    now: () => now,
    resolveActor: async () => ACTOR,
    activitiesRepo: fakeActivitiesRepo(activities),
    photosRepo: fakePhotosRepo([]),
    changesRepo: fakeChangesRepo({ changes, latestSequence: TOTAL }),
  });

  const seenSequences: number[] = [];
  let cursor = encode(0);
  let pages = 0;
  const MAX_PAGES = Math.ceil(TOTAL / limit) + 1;
  for (;;) {
    const response = await GET(
      new Request(
        `https://example.test/api/v1/sync/changes?limit=${limit}&cursor=${encodeURIComponent(cursor)}`,
      ),
    );
    const body = (await response.json()) as {
      data: { items: { sequence: string }[]; nextCursor: string };
    };
    if (body.data.items.length === 0) break;
    for (const item of body.data.items) seenSequences.push(Number(item.sequence));
    cursor = body.data.nextCursor;
    pages += 1;
    assert.ok(pages <= MAX_PAGES, 'pagination must terminate within the expected number of pages');
  }

  assert.equal(seenSequences.length, TOTAL, 'every change must be delivered exactly once');
  assert.equal(new Set(seenSequences).size, TOTAL, 'no sequence may repeat across pages');
  assert.deepEqual(
    seenSequences,
    [...seenSequences].sort((a, b) => a - b),
    'changes must be strictly ordered by sequence across page boundaries',
  );
});
