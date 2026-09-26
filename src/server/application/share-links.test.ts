import assert from 'node:assert/strict';
import test from 'node:test';

import type { Activity } from '~/server/db/schema';
import type { ActivitiesRepository } from '~/server/repositories/activities';
import type {
  NewShareLink,
  ShareLinkRecord,
  ShareLinksRepository,
} from '~/server/repositories/share-links';
import type { Actor } from '~/server/auth/actor';
import { DEFAULT_SHARE_LINK_FIELD_OPTIONS } from '~/lib/sharing/fields';
import {
  MAX_SHARE_LINK_TTL_MS,
  MIN_SHARE_LINK_TTL_MS,
} from '~/server/sharing/validators';

import {
  ForbiddenError,
  ShareLinkNotFoundError,
  ShareLinkUnavailableError,
  createShareLinkForActor,
  getShareView,
  listShareLinksForActor,
  revokeShareLinkForActor,
} from './share-links.ts';

/**
 * These tests exercise the application service against in-memory fake
 * repositories - never a real database - matching
 * `~/server/application/activities.test.ts`'s pattern. Every acceptance
 * criterion for issue #132 that can be proven without a live database is
 * covered here: ownership on create/list/revoke, the explicit-subset and
 * bounded-expiry constraints, and every invalidation condition (expiry,
 * revocation, deleted activity, lost visibility, deauthorized athlete).
 */

const ATHLETE_A = 1001;
const ATHLETE_B = 2002;

const actorFor = (athleteId: number, userId: string): Actor => ({
  userId,
  athleteId,
  authentication: 'cookie',
});

const ACTOR_A = actorFor(ATHLETE_A, 'user-a');
const ACTOR_B = actorFor(ATHLETE_B, 'user-b');

function buildActivity(
  overrides: Partial<Activity> & { id: number; athlete: number },
): Activity {
  return {
    public_id: overrides.id * 7,
    name: `Activity ${overrides.id}`,
    description: null,
    distance: 1000,
    moving_time: 100,
    elapsed_time: 110,
    total_elevation_gain: 10,
    sport_type: 'Run',
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    start_date_local: new Date('2026-01-01T00:00:00.000Z'),
    timezone: 'UTC',
    start_latlng: [1, 2],
    end_latlng: [3, 4],
    achievement_count: null,
    kudos_count: 5,
    comment_count: 1,
    athlete_count: null,
    photo_count: null,
    total_photo_count: null,
    map_id: null,
    map_polyline: null,
    map_summary_polyline: 'poly',
    map_bbox: null,
    trainer: null,
    commute: null,
    manual: null,
    private: false,
    flagged: null,
    workout_type: null,
    upload_id: null,
    average_speed: null,
    max_speed: null,
    calories: null,
    has_heartrate: true,
    average_heartrate: 140,
    max_heartrate: 170,
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

function fakeActivitiesRepo(activities: Activity[]): ActivitiesRepository {
  return {
    async findManyByAthlete(athleteId) {
      return activities.filter((a) => a.athlete === athleteId);
    },
    async findManyByIds(ids) {
      return activities.filter((a) => ids.includes(a.id));
    },
    async findPageByAthlete() {
      return [];
    },
    async deleteManyForAthlete(_athleteId, ids) {
      const remaining = activities.filter((a) => !ids.includes(a.id));
      activities.length = 0;
      activities.push(...remaining);
      return ids;
    },
    async upsertOne(activity) {
      const index = activities.findIndex((a) => a.id === activity.id);
      if (index >= 0) activities[index] = activity;
      else activities.push(activity);
      return activity;
    },
    async replaceExistingForAthlete(athleteId, activity) {
      const index = activities.findIndex(
        (row) => row.id === activity.id && row.athlete === athleteId,
      );
      if (index < 0) return null;
      activities[index] = activity;
      return activity;
    },
  };
}

function fakeShareLinksRepo(
  opts: { revokedAthletes?: Set<number> } = {},
): ShareLinksRepository & {
  rows: ShareLinkRecord[];
} {
  const rows: ShareLinkRecord[] = [];
  let nextId = 1;
  const revokedAthletes = opts.revokedAthletes ?? new Set<number>();

  return {
    rows,
    async create(input: NewShareLink) {
      const record: ShareLinkRecord = {
        id: `share-${nextId++}`,
        athleteId: input.athleteId,
        tokenHash: input.tokenHash,
        createdAt: new Date(),
        expiresAt: input.expiresAt,
        revokedAt: null,
        fields: input.fields,
        activityIds: input.activityIds,
      };
      rows.push(record);
      return record;
    },
    async findByTokenHash(tokenHash) {
      return rows.find((r) => r.tokenHash === tokenHash) ?? null;
    },
    async listForAthlete(athleteId) {
      return rows
        .filter((r) => r.athleteId === athleteId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async revoke(athleteId, shareId, now) {
      const record = rows.find(
        (r) =>
          r.id === shareId && r.athleteId === athleteId && r.revokedAt === null,
      );
      if (!record) return null;
      record.revokedAt = now;
      return record;
    },
    async isAthleteRevoked(athleteId) {
      return revokedAthletes.has(athleteId);
    },
  };
}

const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z');

// ---------------------------------------------------------------------------
// createShareLinkForActor
// ---------------------------------------------------------------------------

void test('createShareLinkForActor creates a share covering exactly the requested activities', async () => {
  const activityA = buildActivity({ id: 1, athlete: ATHLETE_A });
  const activitiesRepo = fakeActivitiesRepo([activityA]);
  const shareLinksRepo = fakeShareLinksRepo();

  const result = await createShareLinkForActor(
    ACTOR_A,
    { activityIds: [1], expiresInMs: MIN_SHARE_LINK_TTL_MS },
    { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
  );

  assert.deepEqual(result.activityIds, [1]);
  assert.ok(result.token.length > 0);
  assert.equal(
    result.expiresAt.getTime(),
    FIXED_NOW.getTime() + MIN_SHARE_LINK_TTL_MS,
  );
  assert.deepEqual(result.fields, DEFAULT_SHARE_LINK_FIELD_OPTIONS);
  // The stored record never holds the plaintext token, only its hash.
  assert.equal(shareLinksRepo.rows[0]?.tokenHash === result.token, false);
});

void test('createShareLinkForActor rejects an activity id belonging to a different athlete', async () => {
  const activityB = buildActivity({ id: 99, athlete: ATHLETE_B });
  const activitiesRepo = fakeActivitiesRepo([activityB]);
  const shareLinksRepo = fakeShareLinksRepo();

  await assert.rejects(
    createShareLinkForActor(
      ACTOR_A,
      { activityIds: [99], expiresInMs: MIN_SHARE_LINK_TTL_MS },
      { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
    ),
    (error: unknown) => error instanceof ForbiddenError,
  );
  assert.equal(
    shareLinksRepo.rows.length,
    0,
    'no share should have been created',
  );
});

void test('createShareLinkForActor rejects an empty activity subset', async () => {
  const activitiesRepo = fakeActivitiesRepo([]);
  const shareLinksRepo = fakeShareLinksRepo();

  await assert.rejects(
    createShareLinkForActor(
      ACTOR_A,
      { activityIds: [], expiresInMs: MIN_SHARE_LINK_TTL_MS },
      { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
    ),
  );
});

void test('createShareLinkForActor rejects an expiry below the minimum', async () => {
  const activityA = buildActivity({ id: 1, athlete: ATHLETE_A });
  const activitiesRepo = fakeActivitiesRepo([activityA]);
  const shareLinksRepo = fakeShareLinksRepo();

  await assert.rejects(
    createShareLinkForActor(
      ACTOR_A,
      { activityIds: [1], expiresInMs: MIN_SHARE_LINK_TTL_MS - 1 },
      { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
    ),
  );
});

void test('createShareLinkForActor rejects an expiry above the bounded maximum', async () => {
  const activityA = buildActivity({ id: 1, athlete: ATHLETE_A });
  const activitiesRepo = fakeActivitiesRepo([activityA]);
  const shareLinksRepo = fakeShareLinksRepo();

  await assert.rejects(
    createShareLinkForActor(
      ACTOR_A,
      { activityIds: [1], expiresInMs: MAX_SHARE_LINK_TTL_MS + 1 },
      { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
    ),
  );
});

void test('createShareLinkForActor rejects a request with no expiry at all', async () => {
  const activityA = buildActivity({ id: 1, athlete: ATHLETE_A });
  const activitiesRepo = fakeActivitiesRepo([activityA]);
  const shareLinksRepo = fakeShareLinksRepo();

  await assert.rejects(
    createShareLinkForActor(
      ACTOR_A,
      // @ts-expect-error - deliberately omitting the mandatory expiry
      { activityIds: [1] },
      { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
    ),
  );
});

void test('createShareLinkForActor never persists the plaintext token', async () => {
  const activityA = buildActivity({ id: 1, athlete: ATHLETE_A });
  const activitiesRepo = fakeActivitiesRepo([activityA]);
  const shareLinksRepo = fakeShareLinksRepo();

  const result = await createShareLinkForActor(
    ACTOR_A,
    { activityIds: [1], expiresInMs: MIN_SHARE_LINK_TTL_MS },
    { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
  );

  for (const row of shareLinksRepo.rows) {
    assert.notEqual(row.tokenHash, result.token);
    assert.ok(!row.tokenHash.includes(result.token));
  }
});

// ---------------------------------------------------------------------------
// listShareLinksForActor / revokeShareLinkForActor - authorization
// ---------------------------------------------------------------------------

void test("listShareLinksForActor only returns the actor's own shares", async () => {
  const activitiesRepo = fakeActivitiesRepo([
    buildActivity({ id: 1, athlete: ATHLETE_A }),
    buildActivity({ id: 2, athlete: ATHLETE_B }),
  ]);
  const shareLinksRepo = fakeShareLinksRepo();

  await createShareLinkForActor(
    ACTOR_A,
    { activityIds: [1], expiresInMs: MIN_SHARE_LINK_TTL_MS },
    { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
  );
  await createShareLinkForActor(
    ACTOR_B,
    { activityIds: [2], expiresInMs: MIN_SHARE_LINK_TTL_MS },
    { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
  );

  const listA = await listShareLinksForActor(ACTOR_A, {
    shareLinksRepo,
    now: () => FIXED_NOW,
  });
  const listB = await listShareLinksForActor(ACTOR_B, {
    shareLinksRepo,
    now: () => FIXED_NOW,
  });

  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.notEqual(listA[0]?.id, listB[0]?.id);
});

void test("revokeShareLinkForActor rejects revoking another athlete's share", async () => {
  const activitiesRepo = fakeActivitiesRepo([
    buildActivity({ id: 1, athlete: ATHLETE_A }),
  ]);
  const shareLinksRepo = fakeShareLinksRepo();

  const created = await createShareLinkForActor(
    ACTOR_A,
    { activityIds: [1], expiresInMs: MIN_SHARE_LINK_TTL_MS },
    { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
  );

  await assert.rejects(
    revokeShareLinkForActor(ACTOR_B, created.id, {
      shareLinksRepo,
      now: () => FIXED_NOW,
    }),
    (error: unknown) => error instanceof ShareLinkNotFoundError,
  );

  // Still active for its real owner.
  const [row] = shareLinksRepo.rows;
  assert.equal(row?.revokedAt, null);
});

void test('revokeShareLinkForActor rejects a nonexistent share id', async () => {
  const shareLinksRepo = fakeShareLinksRepo();
  await assert.rejects(
    revokeShareLinkForActor(ACTOR_A, 'does-not-exist', {
      shareLinksRepo,
      now: () => FIXED_NOW,
    }),
    (error: unknown) => error instanceof ShareLinkNotFoundError,
  );
});

void test('the owner can revoke their own share, and it disappears from the recipient view', async () => {
  const activitiesRepo = fakeActivitiesRepo([
    buildActivity({ id: 1, athlete: ATHLETE_A }),
  ]);
  const shareLinksRepo = fakeShareLinksRepo();

  const created = await createShareLinkForActor(
    ACTOR_A,
    { activityIds: [1], expiresInMs: MIN_SHARE_LINK_TTL_MS },
    { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
  );

  await revokeShareLinkForActor(ACTOR_A, created.id, {
    shareLinksRepo,
    now: () => FIXED_NOW,
  });

  const summaries = await listShareLinksForActor(ACTOR_A, {
    shareLinksRepo,
    now: () => FIXED_NOW,
  });
  assert.equal(summaries[0]?.status, 'revoked');
});

// ---------------------------------------------------------------------------
// getShareView - invalidation conditions
// ---------------------------------------------------------------------------

async function setupValidShare(
  overrides: { fields?: typeof DEFAULT_SHARE_LINK_FIELD_OPTIONS } = {},
) {
  const activityA = buildActivity({ id: 1, athlete: ATHLETE_A });
  const activitiesRepo = fakeActivitiesRepo([activityA]);
  const shareLinksRepo = fakeShareLinksRepo();

  const created = await createShareLinkForActor(
    ACTOR_A,
    {
      activityIds: [1],
      expiresInMs: MIN_SHARE_LINK_TTL_MS * 2,
      fields: overrides.fields ?? DEFAULT_SHARE_LINK_FIELD_OPTIONS,
    },
    { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
  );

  return { activitiesRepo, shareLinksRepo, created, activityA };
}

void test('getShareView returns the confirmed fields for a valid token', async () => {
  const { activitiesRepo, shareLinksRepo, created } = await setupValidShare();

  const view = await getShareView(created.token, {
    activitiesRepo,
    shareLinksRepo,
    now: () => FIXED_NOW,
  });

  assert.equal(view.activities.length, 1);
  assert.equal(view.activities[0]?.id, '1');
  // Defaults exclude heart rate/power/social/precise location.
  assert.equal('average_heartrate' in view.activities[0], false);
  assert.equal('kudos_count' in view.activities[0], false);
  assert.equal('start_latlng' in view.activities[0], false);
});

void test('getShareView rejects an unknown token (never existed)', async () => {
  const { activitiesRepo, shareLinksRepo } = await setupValidShare();

  await assert.rejects(
    getShareView('not-a-real-token', {
      activitiesRepo,
      shareLinksRepo,
      now: () => FIXED_NOW,
    }),
    (error: unknown) => error instanceof ShareLinkUnavailableError,
  );
});

void test('getShareView rejects a guessed/incremented variant of a real token', async () => {
  const { activitiesRepo, shareLinksRepo, created } = await setupValidShare();
  const guessed =
    created.token.slice(0, -1) + (created.token.endsWith('A') ? 'B' : 'A');

  await assert.rejects(
    getShareView(guessed, {
      activitiesRepo,
      shareLinksRepo,
      now: () => FIXED_NOW,
    }),
    (error: unknown) => error instanceof ShareLinkUnavailableError,
  );
});

void test('getShareView rejects an expired share', async () => {
  const { activitiesRepo, shareLinksRepo, created } = await setupValidShare();
  const afterExpiry = new Date(created.expiresAt.getTime() + 1000);

  await assert.rejects(
    getShareView(created.token, {
      activitiesRepo,
      shareLinksRepo,
      now: () => afterExpiry,
    }),
    (error: unknown) => error instanceof ShareLinkUnavailableError,
  );
});

void test('getShareView rejects a revoked share immediately', async () => {
  const { activitiesRepo, shareLinksRepo, created } = await setupValidShare();

  await revokeShareLinkForActor(ACTOR_A, created.id, {
    shareLinksRepo,
    now: () => FIXED_NOW,
  });

  await assert.rejects(
    getShareView(created.token, {
      activitiesRepo,
      shareLinksRepo,
      now: () => FIXED_NOW,
    }),
    (error: unknown) => error instanceof ShareLinkUnavailableError,
  );
});

void test('getShareView rejects every share for a deauthorized athlete, even before erasure runs', async () => {
  const activityA = buildActivity({ id: 1, athlete: ATHLETE_A });
  const activitiesRepo = fakeActivitiesRepo([activityA]);
  const shareLinksRepo = fakeShareLinksRepo({
    revokedAthletes: new Set([ATHLETE_A]),
  });

  const created = await createShareLinkForActor(
    ACTOR_A,
    { activityIds: [1], expiresInMs: MIN_SHARE_LINK_TTL_MS * 2 },
    { activitiesRepo, shareLinksRepo, now: () => FIXED_NOW },
  );

  // Share itself is still fresh and not revoked - only the athlete's Strava
  // connection is - which must be enough to stop it serving data
  // immediately, well before the 30-day erasure transaction runs.
  await assert.rejects(
    getShareView(created.token, {
      activitiesRepo,
      shareLinksRepo,
      now: () => FIXED_NOW,
    }),
    (error: unknown) => error instanceof ShareLinkUnavailableError,
  );
});

void test('getShareView drops a deleted activity from the result without failing the whole share', async () => {
  const { activitiesRepo, shareLinksRepo, created } = await setupValidShare();

  // Simulate `deleteManyForAthlete` hard-deleting the activity (and, in the
  // real schema, cascading away the share_link_activities join row).
  await activitiesRepo.deleteManyForAthlete(ATHLETE_A, [1]);

  const view = await getShareView(created.token, {
    activitiesRepo,
    shareLinksRepo,
    now: () => FIXED_NOW,
  });

  assert.deepEqual(view.activities, []);
});

void test('getShareView drops an activity that lost visibility (became private)', async () => {
  const { activitiesRepo, shareLinksRepo, created, activityA } =
    await setupValidShare();

  await activitiesRepo.upsertOne({ ...activityA, private: true });

  const view = await getShareView(created.token, {
    activitiesRepo,
    shareLinksRepo,
    now: () => FIXED_NOW,
  });

  assert.deepEqual(view.activities, []);
});

void test('getShareView honors an opted-in field group end to end', async () => {
  const { activitiesRepo, shareLinksRepo, created } = await setupValidShare({
    fields: { ...DEFAULT_SHARE_LINK_FIELD_OPTIONS, heartRate: true },
  });

  const view = await getShareView(created.token, {
    activitiesRepo,
    shareLinksRepo,
    now: () => FIXED_NOW,
  });

  assert.equal(view.activities[0]?.average_heartrate, 140);
  assert.equal('average_watts' in view.activities[0], false);
});
