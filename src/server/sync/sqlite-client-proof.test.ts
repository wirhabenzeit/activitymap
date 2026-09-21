import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import type { Actor } from '~/server/auth/actor.ts';
import type { Activity, Photo, SyncChange } from '~/server/db/schema.ts';
import { createSyncBootstrapHandler } from '~/app/api/v1/sync/bootstrap/handler.ts';
import { createSyncChangesHandler } from '~/app/api/v1/sync/changes/handler.ts';
import type { ActivityDTO } from '~/contracts/v1/activity.ts';
import type { PhotoDTO } from '~/contracts/v1/photo.ts';
import type { SyncChangeItemDTO } from '~/contracts/v1/sync.ts';
import { encodeSyncCursor } from '~/server/sync/cursor.ts';

/**
 * End-to-end proof for issue #123: a real SQLite database (Node's built-in
 * `node:sqlite`, the local store a SwiftUI client would use) is populated by
 * calling the actual `/api/v1/sync/bootstrap` and `/api/v1/sync/changes`
 * Route Handler logic in-process - the same `createSyncBootstrapHandler`/
 * `createSyncChangesHandler` factories `route.ts` wires to real
 * repositories - against an in-memory fake "server" (fake
 * Activities/Photos/Changes repositories, in the same spirit as
 * `~/server/application/activities.test.ts`'s fakes). No live Postgres and
 * no Swift toolchain are involved; every assertion below is a real SQLite
 * read after applying real HTTP-shaped JSON responses inside real SQLite
 * transactions.
 *
 * What this proves, matching issue #123's acceptance criteria one for one:
 * - bootstrap fully populates the client store via stable keyset pages;
 * - a mutation that happens *during* bootstrap is not lost, because
 *   `snapshotCursor` is captured before pagination completes and
 *   `/sync/changes` after it picks the mutation up;
 * - delta pages apply cleanly and are idempotent to replay;
 * - a client that stops after some page and resumes with its last-applied
 *   cursor ends up in exactly the state an uninterrupted client would have.
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

/**
 * A fake "server": in-memory activities/photos plus the `sync_change` feed,
 * wired the same way the real repositories are (every mutation appends a
 * change record) - see `~/server/repositories/activities.ts`'s
 * `upsertOne`/`deleteManyForAthlete`. This is the thing under test's
 * *dependency*, not the client-side store; the client-side store is the
 * real SQLite database created per test below.
 */
class FakeServer {
  activities = new Map<number, Activity>();
  photos = new Map<string, Photo>();
  changes: SyncChange[] = [];
  private nextSequence = 1;

  private recordChange(entry: Omit<SyncChange, 'sequence' | 'athleteId' | 'changedAt'>) {
    this.changes.push({
      sequence: this.nextSequence++,
      athleteId: ACTOR.athleteId,
      changedAt: NOW,
      ...entry,
    });
  }

  upsertActivity(activity: Activity) {
    this.activities.set(activity.id, activity);
    this.recordChange({ entityType: 'activity', entityId: String(activity.id), operation: 'upsert' });
  }

  deleteActivity(id: number) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- plain in-memory `Map.delete`, not a drizzle table
    this.activities.delete(id);
    this.recordChange({ entityType: 'activity', entityId: String(id), operation: 'delete' });
  }

  upsertPhoto(photo: Photo) {
    this.photos.set(photo.unique_id, photo);
    this.recordChange({ entityType: 'photo', entityId: photo.unique_id, operation: 'upsert' });
  }

  deletePhoto(id: string) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- plain in-memory `Map.delete`, not a drizzle table
    this.photos.delete(id);
    this.recordChange({ entityType: 'photo', entityId: id, operation: 'delete' });
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
      findAfter: async (
        athleteId: number,
        afterSequence: number,
        { limit = 500 }: { limit?: number } = {},
      ) =>
        this.changes
          .filter((c) => c.athleteId === athleteId && c.sequence > afterSequence)
          .sort((a, b) => a.sequence - b.sequence)
          .slice(0, limit),
    };
  }
}

function buildHandlers(server: FakeServer) {
  const deps = {
    now: () => NOW,
    resolveActor: async () => ACTOR,
    activitiesRepo: server.activitiesRepo(),
    photosRepo: server.photosRepo(),
    changesRepo: server.changesRepo(),
  };
  return {
    bootstrapGET: createSyncBootstrapHandler(deps),
    changesGET: createSyncChangesHandler(deps),
  };
}

/** The client-side local store: a real SQLite database, created fresh per test. */
function createClientDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE activities (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE photos (unique_id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

/** Apply one bootstrap page's activities/photos into SQLite inside a real transaction. */
function applyBootstrapPage(
  db: DatabaseSync,
  resource: 'activities' | 'photos',
  items: (ActivityDTO | PhotoDTO)[],
) {
  db.exec('BEGIN');
  try {
    if (resource === 'activities') {
      const stmt = db.prepare(
        'INSERT INTO activities (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
      );
      for (const item of items as ActivityDTO[]) stmt.run(item.id, JSON.stringify(item));
    } else {
      const stmt = db.prepare(
        'INSERT INTO photos (unique_id, json) VALUES (?, ?) ON CONFLICT(unique_id) DO UPDATE SET json = excluded.json',
      );
      for (const item of items as PhotoDTO[]) stmt.run(item.unique_id, JSON.stringify(item));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Apply one `/sync/changes` page's upserts/tombstones into SQLite inside a real transaction. */
function applyChangesPage(db: DatabaseSync, items: SyncChangeItemDTO[]) {
  db.exec('BEGIN');
  try {
    for (const item of items) {
      if (item.operation === 'delete') {
        if (item.entityType === 'activity') {
          db.prepare('DELETE FROM activities WHERE id = ?').run(item.id);
        } else {
          db.prepare('DELETE FROM photos WHERE unique_id = ?').run(item.id);
        }
        continue;
      }
      if (item.entityType === 'activity' && item.activity) {
        db.prepare(
          'INSERT INTO activities (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
        ).run(item.id, JSON.stringify(item.activity));
      } else if (item.entityType === 'photo' && item.photo) {
        db.prepare(
          'INSERT INTO photos (unique_id, json) VALUES (?, ?) ON CONFLICT(unique_id) DO UPDATE SET json = excluded.json',
        ).run(item.id, JSON.stringify(item.photo));
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function setCursor(db: DatabaseSync, cursor: string) {
  db.prepare(
    'INSERT INTO sync_state (key, value) VALUES (\'cursor\', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(cursor);
}

function getCursor(db: DatabaseSync): string | null {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = \'cursor\'').get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function countRows(db: DatabaseSync, table: 'activities' | 'photos'): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function activityIds(db: DatabaseSync): string[] {
  return (db.prepare('SELECT id FROM activities ORDER BY id').all() as { id: string }[]).map(
    (r) => r.id,
  );
}

type BootstrapResult = { snapshotCursor: string; pageCount: number };

/**
 * Page through one resource's bootstrap to exhaustion, applying every page
 * into `db`. `pageLimit` is kept small in these tests specifically so a
 * handful of seed rows still produce multiple pages, exercising real
 * multi-page keyset pagination rather than a single page that happens to
 * hold everything.
 */
async function bootstrapResource(
  bootstrapGET: (request: Request) => Promise<Response>,
  db: DatabaseSync,
  resource: 'activities' | 'photos',
  pageLimit: number,
  afterPage?: (pageCount: number) => void | Promise<void>,
): Promise<BootstrapResult> {
  let cursor: string | undefined;
  let snapshotCursor: string | null = null;
  let pageCount = 0;

  for (;;) {
    const url = new URL('https://example.test/api/v1/sync/bootstrap');
    url.searchParams.set('resource', resource);
    url.searchParams.set('limit', String(pageLimit));
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await bootstrapGET(new Request(url));
    assert.equal(response.status, 200, `bootstrap ${resource} page must succeed`);
    const body = (await response.json()) as {
      data: {
        items: (ActivityDTO | PhotoDTO)[];
        nextCursor: string | null;
        snapshotCursor: string | null;
      };
    };

    applyBootstrapPage(db, resource, body.data.items);
    pageCount += 1;
    if (body.data.snapshotCursor) snapshotCursor = body.data.snapshotCursor;
    await afterPage?.(pageCount);

    if (body.data.nextCursor === null) break;
    cursor = body.data.nextCursor;
  }

  if (resource === 'activities') {
    // Only `resource=activities`'s first page - the documented start of a
    // bootstrap run - captures the snapshot; see the handler's own doc
    // comment and its dedicated regression test in `handler.test.ts`.
    assert.ok(snapshotCursor, "resource=activities' first page must yield a snapshotCursor");
  }
  return { snapshotCursor: snapshotCursor ?? '', pageCount };
}

/** Drain `/sync/changes` from `cursor` to the end of what is currently available, applying every page. */
async function drainChanges(
  changesGET: (request: Request) => Promise<Response>,
  db: DatabaseSync,
  cursor: string,
): Promise<{ finalCursor: string; totalItems: number }> {
  let current = cursor;
  let totalItems = 0;

  for (;;) {
    const url = new URL('https://example.test/api/v1/sync/changes');
    url.searchParams.set('cursor', current);
    const response = await changesGET(new Request(url));
    assert.equal(response.status, 200, 'changes page must succeed');
    const body = (await response.json()) as {
      data: { items: SyncChangeItemDTO[]; nextCursor: string };
    };

    applyChangesPage(db, body.data.items);
    totalItems += body.data.items.length;
    setCursor(db, body.data.nextCursor);

    if (body.data.nextCursor === current || body.data.items.length === 0) {
      current = body.data.nextCursor;
      break;
    }
    current = body.data.nextCursor;
  }

  return { finalCursor: current, totalItems };
}

void test('bootstrap + catch-up populates a real SQLite store matching server state, across multiple keyset pages', async () => {
  const server = new FakeServer();
  for (let id = 1; id <= 5; id += 1) server.upsertActivity(buildActivity({ id }));
  for (const uid of ['p1', 'p2', 'p3']) server.upsertPhoto(buildPhoto({ unique_id: uid }));

  const { bootstrapGET, changesGET } = buildHandlers(server);
  const db = createClientDb();

  const activitiesResult = await bootstrapResource(bootstrapGET, db, 'activities', 2);
  const photosResult = await bootstrapResource(bootstrapGET, db, 'photos', 2);

  // 5 activities at 2/page -> 3 pages (2, 2, 1); 3 photos at 2/page -> 2 pages.
  assert.equal(activitiesResult.pageCount, 3);
  assert.equal(photosResult.pageCount, 2);

  const { finalCursor } = await drainChanges(changesGET, db, activitiesResult.snapshotCursor);

  assert.equal(countRows(db, 'activities'), 5);
  assert.equal(countRows(db, 'photos'), 3);
  assert.deepEqual(activityIds(db), ['1', '2', '3', '4', '5']);
  assert.equal(
    getCursor(db),
    finalCursor,
    "the client's persisted cursor must match the last cursor drainChanges actually committed",
  );
});

void test('a mutation that happens during bootstrap is not lost: snapshotCursor + a changes catch-up picks it up', async () => {
  const server = new FakeServer();
  for (let id = 1; id <= 4; id += 1) server.upsertActivity(buildActivity({ id }));

  const { bootstrapGET, changesGET } = buildHandlers(server);
  const db = createClientDb();

  // Pause between the first and second real HTTP-shaped bootstrap requests.
  // The first page has captured the snapshot and delivered activity 1; the
  // mutations therefore happen while keyset pagination is genuinely still
  // in progress, rather than merely before the later catch-up begins.
  const { snapshotCursor } = await bootstrapResource(
    bootstrapGET,
    db,
    'activities',
    1,
    (pageCount) => {
      if (pageCount !== 1) return;

      // - update the already-delivered row (bootstrap will not read it again)
      // - delete the next not-yet-delivered row
      // - insert a new row that a later bootstrap page may also see
      server.upsertActivity(buildActivity({ id: 1, name: 'Updated mid-bootstrap' }));
      server.deleteActivity(2);
      server.upsertActivity(buildActivity({ id: 5, name: 'Created mid-bootstrap' }));
    },
  );

  const { totalItems } = await drainChanges(changesGET, db, snapshotCursor);

  assert.equal(totalItems, 3, 'all three concurrent changes must be delivered exactly once');
  assert.deepEqual(
    activityIds(db),
    ['1', '3', '4', '5'],
    'the update, delete, and insert made during bootstrap are all reflected, and nothing else changed',
  );
  const activity1 = db.prepare('SELECT json FROM activities WHERE id = ?').get('1') as {
    json: string;
  };
  assert.equal(
    (JSON.parse(activity1.json) as ActivityDTO).name,
    'Updated mid-bootstrap',
    'the mid-bootstrap update to an already-delivered row is not lost',
  );
});

void test('delta pages are safe to replay: applying the same page twice does not corrupt or duplicate state', async () => {
  const server = new FakeServer();
  server.upsertActivity(buildActivity({ id: 1 }));
  server.upsertActivity(buildActivity({ id: 2 }));
  server.deleteActivity(1);

  const { changesGET } = buildHandlers(server);
  const db = createClientDb();
  db.exec("INSERT INTO activities (id, json) VALUES ('1', '{}')"); // pre-existing local row for the delete to remove

  const response = await changesGET(
    new Request(
      `https://example.test/api/v1/sync/changes?cursor=${encodeURIComponent(
        encodeSyncCursor({
          sequence: 0,
          athleteId: ACTOR.athleteId,
          issuedAt: NOW,
        }),
      )}`,
    ),
  );
  const body = (await response.json()) as { data: { items: SyncChangeItemDTO[]; nextCursor: string } };

  applyChangesPage(db, body.data.items);
  const afterFirstApply = { activities: countRows(db, 'activities'), ids: activityIds(db) };

  // Replay the exact same page again (simulating a client that applied it
  // but crashed before persisting its own advanced cursor, then retried).
  applyChangesPage(db, body.data.items);
  const afterReplay = { activities: countRows(db, 'activities'), ids: activityIds(db) };

  assert.deepEqual(afterReplay, afterFirstApply);
  assert.deepEqual(activityIds(db), ['2']);
});

void test('sync resumes correctly after a simulated interruption: stopping after page N and resuming reaches the same end state as an uninterrupted run', async () => {
  const server = new FakeServer();
  for (let id = 1; id <= 6; id += 1) server.upsertActivity(buildActivity({ id }));

  // Run A: uninterrupted bootstrap, all in one go.
  const uninterrupted = buildHandlers(server);
  const dbA = createClientDb();
  await bootstrapResource(uninterrupted.bootstrapGET, dbA, 'activities', 2);

  // Run B: the client stops after the first page (e.g. app killed) and
  // resumes a fresh session later using only the cursor it had already
  // received and persisted - never restarting from the top.
  const interrupted = buildHandlers(server);
  const dbB = createClientDb();

  const firstUrl = new URL('https://example.test/api/v1/sync/bootstrap');
  firstUrl.searchParams.set('resource', 'activities');
  firstUrl.searchParams.set('limit', '2');
  const firstResponse = await interrupted.bootstrapGET(new Request(firstUrl));
  const firstBody = (await firstResponse.json()) as {
    data: { items: ActivityDTO[]; nextCursor: string | null };
  };
  applyBootstrapPage(dbB, 'activities', firstBody.data.items);
  assert.ok(firstBody.data.nextCursor, 'test setup expects more than one page');
  // --- simulated interruption: process stops here, cursor already persisted ---

  let resumeCursor: string | undefined = firstBody.data.nextCursor ?? undefined;
  for (;;) {
    const url = new URL('https://example.test/api/v1/sync/bootstrap');
    url.searchParams.set('resource', 'activities');
    url.searchParams.set('limit', '2');
    if (resumeCursor) url.searchParams.set('cursor', resumeCursor);
    const response = await interrupted.bootstrapGET(new Request(url));
    const body = (await response.json()) as {
      data: { items: ActivityDTO[]; nextCursor: string | null };
    };
    applyBootstrapPage(dbB, 'activities', body.data.items);
    if (body.data.nextCursor === null) break;
    resumeCursor = body.data.nextCursor;
  }

  assert.deepEqual(activityIds(dbB), activityIds(dbA));
  assert.equal(countRows(dbB, 'activities'), 6);
});
