import assert from 'node:assert/strict';
import test from 'node:test';

import type { Actor } from '~/server/auth/actor.ts';
import type { Activity, Photo, SyncChange } from '~/server/db/schema.ts';
import { createSyncBootstrapHandler } from '~/app/api/v1/sync/bootstrap/handler.ts';
import { createSyncChangesHandler } from '~/app/api/v1/sync/changes/handler.ts';
import { encodeSyncCursor } from '~/server/sync/cursor.ts';
import {
  drainSyncBootstrap,
  drainSyncChanges,
  fetchSyncBootstrapPage,
  fetchSyncChangesPage,
  SyncApiError,
  SyncRebootstrapRequiredError,
  type FetchLike,
} from './v1-client.ts';

/**
 * These tests exercise `~/lib/sync/v1-client.ts` — the web client's v1 sync
 * adapter — against the *real* `/api/v1/sync/bootstrap`/`/api/v1/sync/changes`
 * Route Handler logic (the same `createSyncBootstrapHandler`/
 * `createSyncChangesHandler` factories `route.ts` wires to real
 * repositories), in the same spirit as
 * `~/server/sync/sqlite-client-proof.test.ts`. Only the transport is faked
 * (`fetchImpl` calls the handler in-process instead of over HTTP); the
 * envelope parsing, pagination, and error handling under test are real.
 */

const ACTOR: Actor = { userId: 'user-1', athleteId: 42, authentication: 'cookie' };
const NOW = new Date('2026-09-20T12:00:00.000Z');

function buildActivity(overrides: Partial<Activity> & { id: number }): Activity {
  return {
    athlete: ACTOR.athleteId,
    public_id: overrides.id * 7,
    name: `Activity ${overrides.id}`,
    description: null,
    distance: 1000,
    moving_time: 100,
    elapsed_time: 100,
    total_elevation_gain: 0,
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
    geometryState: null,
    photosState: null,
    lastSummarySeenAt: null,
    lastDetailedFetchedAt: null,
    is_complete: false,
    ...overrides,
  };
}

class FakeServer {
  activities = new Map<number, Activity>();
  photos = new Map<string, Photo>();
  changes: SyncChange[] = [];
  private nextSequence = 1;

  private recordChange(entry: Omit<SyncChange, 'sequence' | 'athleteId' | 'changedAt'>) {
    this.changes.push({ sequence: this.nextSequence++, athleteId: ACTOR.athleteId, changedAt: NOW, ...entry });
  }

  upsertActivity(activity: Activity) {
    this.activities.set(activity.id, activity);
    this.recordChange({ entityType: 'activity', entityId: String(activity.id), operation: 'upsert' });
  }

  deleteActivity(id: number) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory fake, not a drizzle table
    this.activities.delete(id);
    this.recordChange({ entityType: 'activity', entityId: String(id), operation: 'delete' });
  }

  activitiesRepo() {
    return {
      findPageByAthlete: async (athleteId: number, { afterId = 0, limit }: { afterId?: number; limit: number }) =>
        [...this.activities.values()]
          .filter((a) => a.athlete === athleteId && a.id > afterId)
          .sort((a, b) => a.id - b.id)
          .slice(0, limit),
      findManyByIds: async (ids: number[]) => {
        const idSet = new Set(ids);
        return [...this.activities.values()].filter((a) => idSet.has(a.id));
      },
    };
  }

  photosRepo() {
    return {
      findPageByAthlete: async (
        athleteId: number,
        { afterId = '', limit }: { afterId?: string; limit: number },
      ) =>
        [...this.photos.values()]
          .filter((p) => p.athlete_id === athleteId && p.unique_id > afterId)
          .sort((a, b) => (a.unique_id < b.unique_id ? -1 : 1))
          .slice(0, limit),
      findManyByIds: async (ids: string[]) => {
        const idSet = new Set(ids);
        return [...this.photos.values()].filter((p) => idSet.has(p.unique_id));
      },
    };
  }

  changesRepo() {
    return {
      latestSequence: async () => this.changes.at(-1)?.sequence ?? 0,
      findAfter: async (athleteId: number, afterSequence: number, { limit = 500 }: { limit?: number } = {}) =>
        this.changes
          .filter((c) => c.athleteId === athleteId && c.sequence > afterSequence)
          .sort((a, b) => a.sequence - b.sequence)
          .slice(0, limit),
    };
  }
}

function buildFetchImpl(server: FakeServer, actor: Actor | null = ACTOR): FetchLike {
  const deps = {
    now: () => NOW,
    resolveActor: async () => actor,
    activitiesRepo: server.activitiesRepo(),
    photosRepo: server.photosRepo(),
    changesRepo: server.changesRepo(),
  };
  const bootstrapGET = createSyncBootstrapHandler(deps);
  const changesGET = createSyncChangesHandler(deps);

  return async (input, init) => {
    const url = new URL(input, 'https://example.test');
    const request = new Request(url, init);
    if (url.pathname === '/api/v1/sync/bootstrap') return bootstrapGET(request);
    if (url.pathname === '/api/v1/sync/changes') return changesGET(request);
    throw new Error(`Unexpected URL in test fetchImpl: ${input}`);
  };
}

void test('fetchSyncBootstrapPage parses a real bootstrap page into its DTO', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  server.upsertActivity(buildActivity({ id: 2 }));

  const page = await fetchSyncBootstrapPage(
    { resource: 'activities' },
    { fetchImpl: buildFetchImpl(server) },
  );

  assert.equal(page.resource, 'activities');
  assert.equal(page.items.length, 2);
  assert.ok(page.snapshotCursor, 'first activities page must carry a snapshotCursor');
});

void test('fetchSyncBootstrapPage throws SyncApiError for 401 not_authenticated', async () => {
  const server = new FakeServer();

  await assert.rejects(
    fetchSyncBootstrapPage({}, { fetchImpl: buildFetchImpl(server, null) }),
    (error: unknown) => {
      assert.ok(error instanceof SyncApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, 'not_authenticated');
      return true;
    },
  );
});

void test('fetchSyncChangesPage throws SyncRebootstrapRequiredError on 409 sync_rebootstrap_required', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));

  await assert.rejects(
    fetchSyncChangesPage(
      { cursor: encodeSyncCursor({ sequence: 999, athleteId: ACTOR.athleteId, issuedAt: NOW }) },
      { fetchImpl: buildFetchImpl(server) },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SyncRebootstrapRequiredError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'sync_rebootstrap_required');
      return true;
    },
  );
});

void test('drainSyncBootstrap pages through activities to exhaustion and captures snapshotCursor', async () => {
  const server = new FakeServer();
  for (let id = 1; id <= 5; id += 1) server.upsertActivity(buildActivity({ id }));

  const applied: string[] = [];
  const { snapshotCursor } = await drainSyncBootstrap(
    'activities',
    (page) => {
      if (page.resource === 'activities') {
        applied.push(...page.items.map((item) => item.id));
      }
    },
    { limit: 2, fetchImpl: buildFetchImpl(server) },
  );

  assert.deepEqual(applied, ['1', '2', '3', '4', '5']);
  assert.ok(snapshotCursor);
});

void test('drainSyncBootstrap for resource=photos never captures a snapshotCursor', async () => {
  const server = new FakeServer();
  const { snapshotCursor } = await drainSyncBootstrap('photos', () => undefined, {
    fetchImpl: buildFetchImpl(server),
  });
  assert.equal(snapshotCursor, null);
});

void test('drainSyncChanges stops as soon as a page has no items, returning the cursor to persist', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));

  const startCursor = encodeSyncCursor({ sequence: 0, athleteId: ACTOR.athleteId, issuedAt: NOW });
  const pages: number[] = [];
  const { nextCursor, pagesApplied } = await drainSyncChanges(
    startCursor,
    (page) => {
      pages.push(page.items.length);
    },
    { fetchImpl: buildFetchImpl(server) },
  );

  assert.equal(pagesApplied, 1);
  assert.deepEqual(pages, [1]);
  assert.notEqual(nextCursor, startCursor);

  // Calling again from the new cursor with nothing new must yield zero
  // applied pages, not an infinite loop.
  const second = await drainSyncChanges(nextCursor, () => {
    throw new Error('onPage must not be called for an empty page');
  }, { fetchImpl: buildFetchImpl(server) });
  assert.equal(second.pagesApplied, 0);
  assert.equal(second.nextCursor, nextCursor);
});
