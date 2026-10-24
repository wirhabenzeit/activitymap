import assert from 'node:assert/strict';

import test from 'node:test';

import { createSyncBootstrapHandler } from '~/app/api/v1/sync/bootstrap/handler.ts';
import { createSyncChangesHandler } from '~/app/api/v1/sync/changes/handler.ts';
import type { ActivityPlacesResponse } from '~/contracts/activity-places';
import type { ActivityDTO } from '~/contracts/v1/activity.ts';
import type { PhotoDTO } from '~/contracts/v1/photo.ts';
import { syncedActivityPlaces } from '~/lib/activity-places';
import type { Actor } from '~/server/auth/actor.ts';
import type { Activity, Photo, SyncChange } from '~/server/db/schema.ts';
import type { PlaceMatchingRepository } from '~/server/repositories/place-matching';
import { encodeSyncCursor } from '~/server/sync/cursor.ts';

import type { FetchLike } from './v1-client.ts';
import type { V1SyncState } from './v1-store.ts';
import { type V1SyncStoreDeps, runV1Sync } from './v1-sync.ts';

/**
 * `runV1Sync` end to end: real bootstrap/changes handler logic (same as
 * `~/server/sync/sqlite-client-proof.test.ts` and `v1-client.test.ts`)
 * behind a fake `fetchImpl`, plus an in-memory fake of `~/lib/sync/v1-store`
 * (`V1SyncStoreDeps`) standing in for IndexedDB. This proves the
 * orchestration logic itself — bootstrap-then-catch-up, and
 * rebootstrap-on-409 — without needing a browser.
 */

const ACTOR: Actor = {
  userId: 'user-1',
  athleteId: 42,
  authentication: 'cookie',
};
const NOW = new Date('2026-09-20T12:00:00.000Z');
const SCOPE = 'auth:user-1';

function buildActivity(
  overrides: Partial<Activity> & { id: number },
): Activity {
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
    geometryState: 'summary',
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

  private recordChange(
    entry: Omit<SyncChange, 'sequence' | 'athleteId' | 'changedAt'>,
  ) {
    this.changes.push({
      sequence: this.nextSequence++,
      athleteId: ACTOR.athleteId,
      changedAt: NOW,
      ...entry,
    });
  }

  upsertActivity(activity: Activity) {
    this.activities.set(activity.id, activity);
    this.recordChange({
      entityType: 'activity',
      entityId: String(activity.id),
      operation: 'upsert',
    });
  }

  deleteActivity(id: number) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory fake, not a drizzle table
    this.activities.delete(id);
    this.recordChange({
      entityType: 'activity',
      entityId: String(id),
      operation: 'delete',
    });
  }

  activitiesRepo() {
    return {
      findPageByAthlete: async (
        athleteId: number,
        { afterId = 0, limit }: { afterId?: number; limit: number },
      ) =>
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
      findPageByAthlete: async () => [] as Photo[],
      findManyByIds: async () => [] as Photo[],
    };
  }

  changesRepo() {
    return {
      latestSequence: async () => this.changes.at(-1)?.sequence ?? 0,
      findAfter: async (
        athleteId: number,
        afterSequence: number,
        { limit = 500 }: { limit?: number } = {},
      ) =>
        this.changes
          .filter(
            (c) => c.athleteId === athleteId && c.sequence > afterSequence,
          )
          .sort((a, b) => a.sequence - b.sequence)
          .slice(0, limit),
    };
  }
}

function buildFetchImpl(
  server: FakeServer,
  placesRepo?: Pick<PlaceMatchingRepository, 'sync'>,
): FetchLike {
  const deps = {
    now: () => NOW,
    resolveActor: async () => ACTOR,
    activitiesRepo: server.activitiesRepo(),
    photosRepo: server.photosRepo(),
    changesRepo: server.changesRepo(),
    placesRepo,
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

function createFakeStore() {
  const activities = new Map<string, Map<string, ActivityDTO>>();
  const photos = new Map<string, Map<string, PhotoDTO>>();
  const states = new Map<string, V1SyncState>();

  const forActivities = (scope: string) => {
    let m = activities.get(scope);
    if (!m) {
      m = new Map();
      activities.set(scope, m);
    }
    return m;
  };
  const forPhotos = (scope: string) => {
    let m = photos.get(scope);
    if (!m) {
      m = new Map();
      photos.set(scope, m);
    }
    return m;
  };

  const legacy = {
    getV1SyncState: async (scope: string) => states.get(scope) ?? null,
    setV1SyncState: async (state: V1SyncState) => {
      states.set(state.scope, state);
    },
    upsertActivityDTOs: async (scope: string, items: ActivityDTO[]) => {
      const m = forActivities(scope);
      for (const item of items) m.set(item.id, item);
    },
    upsertPhotoDTOs: async (scope: string, items: PhotoDTO[]) => {
      const m = forPhotos(scope);
      for (const item of items) m.set(item.unique_id, item);
    },
    deleteActivityDTOsByIds: async (scope: string, ids: string[]) => {
      const m = forActivities(scope);
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- plain in-memory `Map.delete`, not a drizzle table
      for (const id of ids) m.delete(id);
    },
    deletePhotoDTOsByActivityIds: async (
      scope: string,
      activityIds: string[],
    ) => {
      const m = forPhotos(scope);
      const idSet = new Set(activityIds);
      for (const [key, photo] of m) {
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- plain in-memory `Map.delete`, not a drizzle table
        if (idSet.has(photo.activity_id)) m.delete(key);
      }
    },
    deletePhotoDTOsByIds: async (scope: string, ids: string[]) => {
      const m = forPhotos(scope);
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- plain in-memory `Map.delete`, not a drizzle table
      for (const id of ids) m.delete(id);
    },
    clearV1Scope: async (scope: string) => {
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- plain in-memory `Map.delete`, not a drizzle table
      activities.delete(scope);
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- plain in-memory `Map.delete`, not a drizzle table
      photos.delete(scope);
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- plain in-memory `Map.delete`, not a drizzle table
      states.delete(scope);
    },
  };

  const deps = {
    ...legacy,
    applyV1SyncPage: async (scope, items, state, options) => {
      if (options?.replace) await legacy.clearV1Scope(scope);
      for (const item of items) {
        if (item.entityType === 'activity') {
          if (item.operation === 'upsert')
            await legacy.upsertActivityDTOs(scope, [item.activity!]);
          else {
            await legacy.deleteActivityDTOsByIds(scope, [item.id]);
            await legacy.deletePhotoDTOsByActivityIds(scope, [item.id]);
          }
        } else if (item.operation === 'upsert')
          await legacy.upsertPhotoDTOs(scope, [item.photo!]);
        else await legacy.deletePhotoDTOsByIds(scope, [item.id]);
      }
      await legacy.setV1SyncState(state);
    },
  } satisfies V1SyncStoreDeps & typeof legacy;
  return { deps, activities, states };
}

void test('runV1Sync bootstraps a scope with no prior state', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  server.upsertActivity(buildActivity({ id: 2 }));
  const { deps, activities, states } = createFakeStore();

  const result = await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });

  assert.equal(result.mode, 'bootstrap');
  assert.equal(result.activityUpserts, 2);
  assert.deepEqual([...activities.get(SCOPE)!.keys()].sort(), ['1', '2']);
  assert.equal(states.get(SCOPE)?.bootstrapComplete, true);
  assert.equal(states.get(SCOPE)?.changesCursor, result.cursor);
});

void test('runV1Sync catches up mutations that happen during bootstrap before returning', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  const { deps, activities } = createFakeStore();
  const serverFetch = buildFetchImpl(server);
  let mutatedDuringBootstrap = false;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input, 'https://example.test');
    if (
      !mutatedDuringBootstrap &&
      url.pathname === '/api/v1/sync/bootstrap' &&
      url.searchParams.get('resource') === 'photos'
    ) {
      mutatedDuringBootstrap = true;
      server.upsertActivity(buildActivity({ id: 2 }));
      server.deleteActivity(1);
    }
    return serverFetch(input, init);
  };

  const result = await runV1Sync({ scope: SCOPE, store: deps, fetchImpl });

  assert.equal(result.mode, 'bootstrap');
  assert.equal(result.activityUpserts, 2);
  assert.equal(result.activityDeletes, 1);
  assert.deepEqual(
    [...activities.get(SCOPE)!.keys()],
    ['2'],
    'the completed sync pass must include changes after its bootstrap snapshot',
  );
});

void test('runV1Sync clears partial rows before retrying an interrupted bootstrap', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  const { deps, activities } = createFakeStore();
  let interruptOnce = true;
  const interruptedStore: V1SyncStoreDeps = {
    ...deps,
    applyV1SyncPage: async (scope, items, state, options) => {
      await deps.applyV1SyncPage(scope, items, state, options);
      if (interruptOnce) {
        interruptOnce = false;
        throw new Error('simulated browser interruption');
      }
    },
  };

  await assert.rejects(
    runV1Sync({
      scope: SCOPE,
      store: interruptedStore,
      fetchImpl: buildFetchImpl(server),
    }),
    /simulated browser interruption/,
  );
  assert.deepEqual([...activities.get(SCOPE)!.keys()], ['1']);

  server.deleteActivity(1);
  server.upsertActivity(buildActivity({ id: 2 }));

  await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });

  assert.deepEqual(
    [...activities.get(SCOPE)!.keys()],
    ['2'],
    'a row deleted between bootstrap attempts must not survive locally',
  );
});

void test('runV1Sync catches up via /sync/changes once a scope has already bootstrapped', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  const { deps, activities } = createFakeStore();

  await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });

  server.upsertActivity(buildActivity({ id: 2 }));
  server.deleteActivity(1);

  const result = await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });

  assert.equal(result.mode, 'changes');
  assert.equal(result.activityUpserts, 1);
  assert.equal(result.activityDeletes, 1);
  assert.deepEqual([...activities.get(SCOPE)!.keys()].sort(), ['2']);
});

void test('runV1Sync atomically replaces local state after re-bootstrap on 409 sync_rebootstrap_required', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  const { deps, activities, states } = createFakeStore();

  // Seed a sync state whose cursor the server will reject (sequence far
  // beyond the feed's current high-water mark), simulating retention
  // expiry or a corrupted local cursor.
  await deps.setV1SyncState({
    scope: SCOPE,
    bootstrapCursor: 'stale',
    bootstrapComplete: true,
    changesCursor: encodeSyncCursor({
      sequence: 999,
      athleteId: ACTOR.athleteId,
      issuedAt: NOW,
    }),
    lastSyncAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  await deps.upsertActivityDTOs(SCOPE, [
    { id: '999' } as ActivityDTO, // stale row a real bootstrap for this fixture would never produce
  ]);

  const result = await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });

  assert.equal(
    result.mode,
    'bootstrap',
    'a rejected cursor must fall back to a fresh bootstrap',
  );
  assert.deepEqual(
    [...activities.get(SCOPE)!.keys()].sort(),
    ['1'],
    'rows absent from the completed replacement must disappear',
  );
  assert.equal(states.get(SCOPE)?.bootstrapComplete, true);
});

void test('runV1Sync publishes ordered activity tombstones to client cache fences', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  const { deps } = createFakeStore();
  const observed: string[] = [];
  const onActivityChanges = (
    changes: Array<{ activityId: string; operation: 'upsert' | 'delete' }>,
  ) => {
    observed.push(
      ...changes.map((change) => `${change.operation}:${change.activityId}`),
    );
  };

  await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
    onActivityChanges,
  });
  observed.length = 0;
  server.deleteActivity(1);

  await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
    onActivityChanges,
  });
  assert.deepEqual(observed, ['delete:1']);
});

void test('runV1Sync fences the whole scope before a cursor-expiry rebootstrap publishes rows', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  const { deps } = createFakeStore();
  await deps.setV1SyncState({
    scope: SCOPE,
    bootstrapCursor: 'stale',
    bootstrapComplete: true,
    changesCursor: encodeSyncCursor({
      sequence: 999,
      athleteId: ACTOR.athleteId,
      issuedAt: NOW,
    }),
    lastSyncAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  const observed: string[] = [];

  await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
    onScopeReset: () => {
      observed.push('reset');
    },
    onActivityChanges: (changes) => {
      observed.push(
        ...changes.map((change) => `${change.operation}:${change.activityId}`),
      );
    },
  });

  assert.equal(observed[0], 'reset');
  assert.ok(observed.includes('upsert:1'));
});

void test('real filtered change pages cannot hide later tombstones', async () => {
  const server = new FakeServer();
  for (let id = 1; id <= 501; id++)
    server.upsertActivity(buildActivity({ id }));
  for (let id = 1; id <= 501; id++) server.deleteActivity(id);
  const { deps, activities } = createFakeStore();
  const cursor = encodeSyncCursor({
    sequence: 0,
    athleteId: ACTOR.athleteId,
    issuedAt: NOW,
  });
  await deps.setV1SyncState({
    scope: SCOPE,
    bootstrapCursor: cursor,
    bootstrapComplete: true,
    changesCursor: cursor,
    lastSyncAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  await deps.upsertActivityDTOs(SCOPE, [{ id: '501' } as ActivityDTO]);
  const result = await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });
  assert.equal(result.activityDeletes, 501);
  assert.deepEqual([...activities.get(SCOPE)!.keys()], []);
});

void test('real delete then recreate feed leaves the recreated activity present', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  const { deps, activities } = createFakeStore();
  await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });
  server.deleteActivity(1);
  server.upsertActivity(buildActivity({ id: 1, name: 'Recreated' }));
  await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });
  assert.equal(activities.get(SCOPE)?.get('1')?.name, 'Recreated');
});

void test('place bundles bootstrap, replace visits with zeroes, invalidate on empty pages and disappear with their activity', async () => {
  const server = new FakeServer();
  const activity = buildActivity({ id: 1 });
  server.upsertActivity(activity);
  const { deps, activities, states } = createFakeStore();
  let version = 'a'.repeat(64);
  let bundle: ActivityPlacesResponse = {
    userId: ACTOR.userId,
    activityId: '1',
    status: 'complete',
    streamGeneration: 'g',
    streamRevision: '1',
    catalogueSnapshotId: 'catalogue',
    matcherVersion: 'v5',
    matchingVersion: version,
    resultRevision: 'first',
    places: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Summit',
        kinds: ['peak'],
        longitude: 8,
        latitude: 46,
        elevationM: 2000,
        visits: [{ distanceM: 300 }],
      },
    ],
  };
  const requests: string[][] = [];
  const fetchImpl = buildFetchImpl(server, {
    sync: async (actor, ids) => {
      assert.deepEqual(actor, ACTOR);
      requests.push(ids);
      return { version, results: new Map(ids.map((id) => [id, bundle])) };
    },
  });
  const sync = () => runV1Sync({ scope: SCOPE, store: deps, fetchImpl });
  const saved = () => activities.get(SCOPE)!.get('1')!;
  await sync();
  assert.equal(saved().placeMatches?.places.length, 1);
  assert.equal(states.get(SCOPE)?.placeMatchingVersion, version);
  assert.equal(states.get(SCOPE)?.placesSyncReady, true);
  assert.deepEqual(
    requests[0],
    ['1'],
    'results are fetched for the whole page',
  );

  bundle = { ...bundle, resultRevision: 'zero', places: [] };
  server.upsertActivity(activity); // Same activity metadata, new matching event.
  await sync();
  assert.deepEqual(saved().placeMatches?.places, []);
  assert.equal(saved().placeMatches?.resultRevision, 'zero');

  version = 'b'.repeat(64); // Catalogue/algorithm changed; no completed result yet.
  await sync();
  assert.equal(states.get(SCOPE)?.placeMatchingVersion, version);
  assert.equal(syncedActivityPlaces(saved(), ACTOR.userId, version), undefined);
  bundle = {
    ...bundle,
    matchingVersion: version,
    resultRevision: 'new-version',
  };
  server.upsertActivity(activity);
  await sync();
  assert.equal(
    syncedActivityPlaces(saved(), ACTOR.userId, version)?.resultRevision,
    'new-version',
  );
  server.deleteActivity(1);
  await sync();
  assert.equal(activities.get(SCOPE)?.size, 0);
});

void test('a legacy cache upgrades once when the server supports place sync, preserving it if staged bootstrap fails', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  const { deps, activities, states } = createFakeStore();
  await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: buildFetchImpl(server),
  });
  assert.equal(states.get(SCOPE)?.placesSyncReady, false);
  const version = 'c'.repeat(64);
  const network = buildFetchImpl(server, {
    sync: async () => ({ version, results: new Map() }),
  });
  const failing: FetchLike = async (input, init) => {
    if (input.includes('/bootstrap')) throw new Error('offline');
    return network(input, init);
  };
  await assert.rejects(
    runV1Sync({ scope: SCOPE, store: deps, fetchImpl: failing }),
    /offline/,
  );
  assert.equal(activities.get(SCOPE)?.size, 1);
  assert.equal(states.get(SCOPE)?.placesSyncReady, false);
  const result = await runV1Sync({
    scope: SCOPE,
    store: deps,
    fetchImpl: network,
  });
  assert.equal(result.mode, 'bootstrap');
  assert.equal(states.get(SCOPE)?.placesSyncReady, true);
  assert.equal(
    (await runV1Sync({ scope: SCOPE, store: deps, fetchImpl: network })).mode,
    'changes',
  );
});
