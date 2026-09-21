import assert from 'node:assert/strict';

import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { resolveMigrationTarget } from '../../src/server/db/migration-tooling.ts';
import {
  accounts,
  activities,
  activityDeletions,
  photoDeletions,
  photos,
  stravaSummaryReconciliations,
  syncChanges,
  users,
} from '../../src/server/db/schema.ts';
import { createSummaryReconciliationRepository } from '../../src/server/repositories/summary-reconciliation.ts';
import { StravaApiError } from '../../src/server/strava/client.ts';
import {
  reconcileStravaSummaries,
  SUMMARY_RECONCILIATION_INTERVAL_MS,
  type SummaryReconciliationSource,
} from '../../src/server/strava/summary-reconciliation.ts';
import type { StravaActivity } from '../../src/server/strava/types.ts';

const environment = process.env;
const target = resolveMigrationTarget(environment);
if (
  !target.isLocal ||
  environment.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'The summary reconciliation proof may only modify a guarded local *_test database',
  );
}

const client = postgres(target.connectionString, {
  max: 4,
  onnotice: () => undefined,
  prepare: false,
});
const testDb = drizzle(client);
const repository = createSummaryReconciliationRepository(
  testDb as unknown as Parameters<typeof createSummaryReconciliationRepository>[0],
);

const NOW = new Date('2026-09-20T12:00:00.000Z');
const USER_ID = 'summary-reconciliation-proof-user';
const ACCOUNT_ID = 'summary-reconciliation-proof-account';
const ATHLETE_ID = 9_101_001;
const ACTIVITY_IDS = [9_102_001, 9_102_002, 9_102_003, 9_102_004] as const;

function stravaActivity(
  id: number,
  overrides: Partial<StravaActivity> = {},
): StravaActivity {
  return {
    id,
    resource_state: 2,
    athlete: {
      id: ATHLETE_ID,
      resource_state: 1,
      firstname: 'Proof',
      lastname: 'Athlete',
      profile_medium: '',
      profile: '',
      city: '',
      state: '',
      country: '',
      sex: 'F',
      premium: false,
      summit: false,
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    name: `Proof activity ${id}`,
    description: null,
    distance: 10_000,
    moving_time: 3_600,
    elapsed_time: 3_700,
    total_elevation_gain: 100,
    elev_high: 500,
    elev_low: 400,
    sport_type: 'Run',
    start_date: '2026-01-01T08:00:00Z',
    start_date_local: '2026-01-01T09:00:00Z',
    timezone: '(GMT+01:00) Europe/Zurich',
    start_latlng: [47, 8],
    end_latlng: [47.1, 8.1],
    achievement_count: 1,
    kudos_count: 2,
    comment_count: 3,
    athlete_count: 1,
    photo_count: 1,
    total_photo_count: 1,
    map: {
      id: `map-${id}`,
      polyline: 'detailed-polyline',
      summary_polyline: '_ibE_seK_seK_seK',
      resource_state: 2,
    },
    trainer: false,
    commute: false,
    manual: false,
    private: false,
    flagged: false,
    workout_type: null,
    upload_id: id + 1_000,
    average_speed: 2.8,
    max_speed: 4.2,
    has_kudoed: false,
    hide_from_home: false,
    gear_id: null,
    kilojoules: null,
    average_watts: null,
    device_watts: false,
    max_watts: null,
    weighted_average_watts: null,
    calories: 500,
    device_name: null,
    pr_count: 0,
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await testDb
    .delete(activityDeletions)
    .where(eq(activityDeletions.athlete_id, ATHLETE_ID));
  await testDb
    .delete(photoDeletions)
    .where(eq(photoDeletions.athlete_id, ATHLETE_ID));
  await testDb.delete(users).where(eq(users.id, USER_ID));
}

async function seed(): Promise<void> {
  await testDb.insert(users).values({
    id: USER_ID,
    athlete_id: ATHLETE_ID,
  });
  await testDb.insert(accounts).values({
    id: ACCOUNT_ID,
    userId: USER_ID,
    providerId: 'strava',
    accountId: String(ATHLETE_ID),
    accessToken: 'summary-reconciliation-proof-token',
    access_token: 'summary-reconciliation-proof-token',
  });
  await testDb.insert(activities).values([
    {
      id: ACTIVITY_IDS[0],
      public_id: ACTIVITY_IDS[0] + 10_000,
      athlete: ATHLETE_ID,
      name: 'Existing detailed activity',
      distance: 10_000,
      moving_time: 3_600,
      elapsed_time: 3_700,
      total_elevation_gain: 100,
      sport_type: 'Run',
      start_date: new Date('2026-01-01T08:00:00Z'),
      // Production-shaped legacy value: the old transformer reparsed the
      // activity wall clock in the host timezone, so this differs from the
      // corrected Strava `start_date_local` value used by the incoming page.
      start_date_local: new Date('2026-01-01T08:00:00Z'),
      timezone: '(GMT+01:00) Europe/Zurich',
      start_latlng: [46.999, 7.999],
      end_latlng: [47.101, 8.101],
      photo_count: 1,
      total_photo_count: 1,
      map_id: `map-${ACTIVITY_IDS[0]}`,
      map_polyline: 'stored-detailed-polyline',
      map_summary_polyline: '_ibE_seK_seK_seK',
      map_bbox: [2, 1, 4, 3],
      // This is the deterministic result of the NOT NULL migration's
      // `is_complete` backfill before the first summary reconciliation.
      geometryState: 'detailed',
      photosState: 'current',
      lastSummarySeenAt: null,
      lastDetailedFetchedAt: null,
      is_complete: true,
    },
    ...ACTIVITY_IDS.slice(1, 3).map((id) => ({
      id,
      public_id: id + 10_000,
      athlete: ATHLETE_ID,
      name: `Candidate ${id}`,
      sport_type: 'Run' as const,
      start_date: new Date('2025-01-01T08:00:00Z'),
      start_date_local: new Date('2025-01-01T09:00:00Z'),
      timezone: '(GMT+01:00) Europe/Zurich',
      geometryState: 'detailed' as const,
      photosState: 'current' as const,
      lastSummarySeenAt: new Date('2026-09-01T00:00:00Z'),
      lastDetailedFetchedAt: new Date('2026-09-01T00:00:00Z'),
      is_complete: true,
    })),
  ]);
  await testDb.insert(photos).values({
    unique_id: 'summary-proof-deleted-photo',
    activity_id: ACTIVITY_IDS[1],
    athlete_id: ATHLETE_ID,
    type: 0,
  });
}

async function resolveAccount() {
  const [account] = await testDb
    .select()
    .from(accounts)
    .where(eq(accounts.id, ACCOUNT_ID));
  return account ?? null;
}

const source: SummaryReconciliationSource = {
  async listPage({ page }) {
    if (page !== 1) return [];
    return [
      stravaActivity(ACTIVITY_IDS[0], {
        kudos_count: 99,
        photo_count: 2,
        total_photo_count: 2,
        map: {
          ...stravaActivity(ACTIVITY_IDS[0]).map,
          polyline: null,
        },
      }),
      stravaActivity(ACTIVITY_IDS[3], {
        photo_count: 0,
        total_photo_count: 0,
        map: {
          ...stravaActivity(ACTIVITY_IDS[3]).map,
          polyline: null,
        },
      }),
    ];
  },
  async getActivity(activityId) {
    if (activityId === ACTIVITY_IDS[1]) {
      throw new StravaApiError('Record Not Found', 404);
    }
    if (activityId === ACTIVITY_IDS[2]) {
      return stravaActivity(activityId, { description: 'Still available' });
    }
    throw new Error('Unexpected detail confirmation request');
  },
};

async function run(): Promise<void> {
  await cleanup();
  await seed();

  const dueBefore = new Date(
    NOW.getTime() - SUMMARY_RECONCILIATION_INTERVAL_MS,
  );
  const [candidate] = await repository.listDue(1, dueBefore, NOW);
  assert.ok(candidate);
  const claims = await Promise.all([
    repository.claim(candidate, dueBefore, NOW, 600_000),
    repository.claim(candidate, dueBefore, NOW, 600_000),
  ]);
  assert.equal(claims.filter(Boolean).length, 1, 'only one overlapping worker may claim an athlete');
  const initialClaim = claims.find((claim) => claim !== null);
  assert.ok(initialClaim);
  await repository.release(initialClaim, NOW);

  const common = {
    now: NOW,
    pageSize: 2,
    pagesPerAthlete: 1,
    confirmationsPerAthlete: 1,
    repository,
    resolveAccount,
    createSource: () => source,
  };

  const first = await reconcileStravaSummaries(common);
  assert.equal(first.partial, 1);
  assert.equal(first.completed, 0);
  const [scanning] = await testDb
    .select()
    .from(stravaSummaryReconciliations)
    .where(eq(stravaSummaryReconciliations.athleteId, ATHLETE_ID));
  assert.equal(scanning?.phase, 'scanning');
  assert.equal(scanning?.nextPage, 2);
  assert.equal(await repository.lastCompletedAt(ATHLETE_ID), null);

  const second = await reconcileStravaSummaries(common);
  assert.equal(second.deleted, 1);
  assert.equal(second.partial, 1);
  const [confirming] = await testDb
    .select()
    .from(stravaSummaryReconciliations)
    .where(eq(stravaSummaryReconciliations.athleteId, ATHLETE_ID));
  assert.equal(confirming?.phase, 'confirming');
  assert.equal(confirming?.candidateAfterId, ACTIVITY_IDS[1]);
  assert.equal(await repository.lastCompletedAt(ATHLETE_ID), null);

  const third = await reconcileStravaSummaries(common);
  assert.equal(third.confirmedPresent, 1);
  assert.equal(third.completed, 1);
  assert.equal(
    (await repository.lastCompletedAt(ATHLETE_ID))?.toISOString(),
    NOW.toISOString(),
  );
  assert.equal(
    (
      await testDb
        .select()
        .from(stravaSummaryReconciliations)
        .where(eq(stravaSummaryReconciliations.athleteId, ATHLETE_ID))
    ).length,
    0,
  );

  const rows = await testDb
    .select()
    .from(activities)
    .where(inArray(activities.id, ACTIVITY_IDS));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const updated = byId.get(ACTIVITY_IDS[0]);
  assert.ok(updated);
  assert.equal(updated.geometryState, 'detailed');
  assert.equal(updated.photosState, 'refresh_required');
  assert.equal(updated.map_polyline, 'stored-detailed-polyline');
  assert.equal(updated.kudos_count, 99);
  assert.equal(updated.lastSummarySeenAt?.toISOString(), NOW.toISOString());
  assert.equal(byId.has(ACTIVITY_IDS[1]), false);
  assert.equal(byId.get(ACTIVITY_IDS[2])?.geometryState, 'detailed');
  assert.equal(byId.get(ACTIVITY_IDS[2])?.description, 'Still available');
  assert.equal(byId.get(ACTIVITY_IDS[3])?.geometryState, 'summary');
  assert.equal(byId.get(ACTIVITY_IDS[3])?.photosState, 'current');

  const [activityTombstone] = await testDb
    .select()
    .from(activityDeletions)
    .where(
      and(
        eq(activityDeletions.athlete_id, ATHLETE_ID),
        eq(activityDeletions.activity_id, ACTIVITY_IDS[1]),
      ),
    );
  const [photoTombstone] = await testDb
    .select()
    .from(photoDeletions)
    .where(eq(photoDeletions.photo_id, 'summary-proof-deleted-photo'));
  assert.ok(activityTombstone);
  assert.ok(photoTombstone);

  const changes = await testDb
    .select()
    .from(syncChanges)
    .where(eq(syncChanges.athleteId, ATHLETE_ID));
  assert.ok(
    changes.some(
      (change) =>
        change.entityType === 'activity' &&
        change.entityId === String(ACTIVITY_IDS[1]) &&
        change.operation === 'delete',
    ),
  );
  assert.ok(
    changes.some(
      (change) =>
        change.entityType === 'photo' &&
        change.entityId === 'summary-proof-deleted-photo' &&
        change.operation === 'delete',
    ),
  );
}

try {
  await run();
  console.log('Summary reconciliation PostgreSQL proof passed.');
} finally {
  await cleanup();
  await client.end({ timeout: 5 });
}
