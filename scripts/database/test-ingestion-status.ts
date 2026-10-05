import assert from 'node:assert/strict';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling.ts';
import {
  accounts,
  activities,
  activityDetailAttempts,
  activityStreams,
  backgroundJobRuns,
  ingestionOutcomes,
  photos,
  streamBackfillAccounts,
  streamBackfillAttempts,
  stravaSummaryReconciliations,
  users,
} from '../../src/server/db/schema.ts';
import { createIngestionRepository } from '../../src/server/repositories/ingestion.ts';
import { createIngestionStatusRepository } from '../../src/server/repositories/ingestion-status.ts';
import { deriveIngestionStatus } from '../../src/server/application/ingestion-status.ts';
import { ingestionStatusDTOSchema } from '../../src/contracts/v1/ingestion-status.ts';
import { updateIncompleteActivities } from '../../src/server/strava/sync.ts';
import { StravaApiError } from '../../src/server/strava/client.ts';

/**
 * PostgreSQL proof for issue #296/#297: the shared detail eligibility, detail
 * retry backoff, per-account outcomes, job heartbeats and the account-scoped
 * status snapshot, against the real schema and migrations.
 */
const environment = process.env;
const target = resolveMigrationTarget(environment);
if (
  !target.isLocal ||
  environment.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'The ingestion status proof may only modify a guarded local *_test database',
  );
}

const client = postgres(target.connectionString, {
  max: 4,
  onnotice: () => undefined,
  prepare: false,
});
const testDb = drizzle(client);
type Database = Parameters<typeof createIngestionRepository>[0];
const database = testDb as unknown as Database;

let time = new Date('2026-10-05T12:00:00.000Z');
const clock = () => new Date(time);
const ingestion = createIngestionRepository(database, clock);
const statusRepository = createIngestionStatusRepository(database);

const USER = 'ingestion-proof-user';
const OTHER = 'ingestion-proof-other';
const REVOKED = 'ingestion-proof-revoked';
const ATHLETE = 9_296_001;
const OTHER_ATHLETE = 9_296_002;
const REVOKED_ATHLETE = 9_296_003;
const USER_IDS = [USER, OTHER, REVOKED];
const id = (athlete: number, n: number) => athlete * 1000 + n;

async function cleanup() {
  await testDb.delete(users).where(inArray(users.id, USER_IDS));
  await testDb
    .delete(backgroundJobRuns)
    .where(inArray(backgroundJobRuns.job, ['reconcile-strava-summaries', 'sync-activities']));
}

function activity(
  athlete: number,
  n: number,
  geometryState: 'summary' | 'detailed' | 'refresh_required',
  overrides: Partial<typeof activities.$inferInsert> = {},
): typeof activities.$inferInsert {
  return {
    id: id(athlete, n),
    public_id: id(athlete, n) + 500_000_000,
    athlete,
    name: `Proof ${n}`,
    sport_type: 'Run',
    // Local wall time 08:00 UTC so a timezone mapping bug would be visible.
    start_date: new Date(Date.UTC(2020 + n, 0, 1, 8)),
    start_date_local: new Date(Date.UTC(2020 + n, 0, 1, 9)),
    timezone: '(GMT+01:00) Europe/Zurich',
    geometryState,
    is_complete: geometryState === 'detailed',
    ...overrides,
  };
}

async function seed() {
  await testDb.insert(users).values([
    { id: USER, athlete_id: ATHLETE, lastSummaryReconciledAt: new Date('2026-10-03T12:00:00.000Z') },
    { id: OTHER, athlete_id: OTHER_ATHLETE },
    { id: REVOKED, athlete_id: REVOKED_ATHLETE },
  ]);
  await testDb.insert(accounts).values([
    {
      id: 'ingestion-proof-account',
      userId: USER,
      providerId: 'strava',
      accountId: String(ATHLETE),
      accessToken: 'proof-access',
      refreshToken: 'proof-refresh',
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    {
      id: 'ingestion-proof-other-account',
      userId: OTHER,
      providerId: 'strava',
      accountId: String(OTHER_ATHLETE),
      accessToken: 'other-access',
    },
    {
      id: 'ingestion-proof-revoked-account',
      userId: REVOKED,
      providerId: 'strava',
      accountId: String(REVOKED_ATHLETE),
      revokedAt: new Date('2026-10-01T00:00:00.000Z'),
    },
  ]);
  await testDb.insert(activities).values([
    // 1-4 detailed (1 with photos current, 2 with photos stale), 5-6 summary,
    // 7 invalidated, 8 summary with photos and no state yet.
    activity(ATHLETE, 1, 'detailed', { total_photo_count: 2, photosState: 'current' }),
    activity(ATHLETE, 2, 'detailed', { total_photo_count: 1, photosState: 'refresh_required' }),
    activity(ATHLETE, 3, 'detailed', { manual: true }),
    activity(ATHLETE, 4, 'detailed'),
    activity(ATHLETE, 5, 'summary'),
    activity(ATHLETE, 6, 'summary'),
    activity(ATHLETE, 7, 'refresh_required', { is_complete: false }),
    activity(ATHLETE, 8, 'summary', { photo_count: 1 }),
    // Another account's pending work must never appear in this account.
    activity(OTHER_ATHLETE, 1, 'summary', { total_photo_count: 4 }),
    activity(OTHER_ATHLETE, 2, 'refresh_required'),
    activity(REVOKED_ATHLETE, 1, 'summary'),
  ]);
  await testDb.insert(photos).values([
    { unique_id: 'proof-photo-1', activity_id: id(ATHLETE, 1), athlete_id: ATHLETE, type: 1 },
    { unique_id: 'proof-photo-2', activity_id: id(ATHLETE, 1), athlete_id: ATHLETE, type: 1 },
    { unique_id: 'proof-photo-3', activity_id: id(ATHLETE, 2), athlete_id: ATHLETE, type: 1 },
    { unique_id: 'proof-photo-other', activity_id: id(OTHER_ATHLETE, 1), athlete_id: OTHER_ATHLETE, type: 1 },
  ]);
  const stream = (
    n: number,
    overrides: Partial<typeof activityStreams.$inferInsert>,
  ): typeof activityStreams.$inferInsert => ({
    activityId: BigInt(id(ATHLETE, n)),
    generation: `gen-${n}`,
    requestedTypes: ['time', 'distance', 'latlng', 'altitude', 'watts', 'heartrate'],
    availableTypes: [],
    lastAttemptAt: new Date('2026-10-01T00:00:00.000Z'),
    lastAttemptStatus: 'succeeded',
    ...overrides,
  });
  await testDb.insert(activityStreams).values([
    // 1: fetched with data and a chart summary; 2: fetched with data, no summary
    stream(1, {
      availableTypes: ['time', 'altitude'],
      fetchedAt: new Date('2026-10-01T00:00:00.000Z'),
      summary: { version: 1 } as never,
    }),
    stream(2, { availableTypes: ['time'], fetchedAt: new Date('2026-10-01T00:00:00.000Z') }),
    // 3: manual activity, successfully fetched with no streams at all
    stream(3, { fetchedAt: new Date('2026-10-01T00:00:00.000Z') }),
    // 4: previously fetched, then invalidated by a route change
    stream(4, {
      availableTypes: ['time'],
      fetchedAt: new Date('2026-09-01T00:00:00.000Z'),
      invalidatedAt: new Date('2026-10-02T00:00:00.000Z'),
      lastAttemptStatus: 'invalidated',
    }),
    // 5: on-demand fetch failed; retry scheduled in the future
    stream(5, {
      lastAttemptStatus: 'failed',
      nextRetryAt: new Date('2026-10-05T14:00:00.000Z'),
    }),
    // 6: backfill gave up permanently on this generation
    stream(6, { lastAttemptStatus: 'failed' }),
  ]);
  await testDb.insert(streamBackfillAttempts).values({
    activityId: BigInt(id(ATHLETE, 6)),
    generation: 'gen-6',
    attemptCount: 3,
    lastAttemptAt: new Date('2026-10-04T00:00:00.000Z'),
    terminal: true,
  });
}

async function run() {
  await verifyConnectedTarget(client, target);
  await cleanup();
  await seed();

  // --- Shared eligibility and detail retry backoff ---
  assert.deepEqual(
    (await ingestion.findDetailCandidates(ATHLETE, 10)).sort(),
    [5, 6, 7, 8].map((n) => id(ATHLETE, n)).sort(),
    'never-fetched and invalidated details are pending; detailed, no-GPS included, are not',
  );

  const sixFails = async () =>
    ingestion.recordDetailFailures([
      { activityId: id(ATHLETE, 6), code: 'upstream_error' },
    ]);
  await sixFails();
  time = new Date('2026-10-05T12:30:00.000Z');
  assert.equal(
    (await ingestion.findDetailCandidates(ATHLETE, 10)).includes(id(ATHLETE, 6)),
    false,
    'a failed activity backs off instead of starving the rest',
  );
  time = new Date('2026-10-05T13:00:00.000Z');
  assert.equal(
    (await ingestion.findDetailCandidates(ATHLETE, 10)).includes(id(ATHLETE, 6)),
    true,
    'after its first one-hour backoff it is eligible again',
  );
  await sixFails();
  const [attempt] = await testDb
    .select()
    .from(activityDetailAttempts)
    .where(eq(activityDetailAttempts.activityId, id(ATHLETE, 6)));
  assert.equal(attempt?.attemptCount, 2);
  assert.equal(
    attempt?.nextAttemptAt.toISOString(),
    '2026-10-05T15:00:00.000Z',
    'the second failure doubles the backoff',
  );
  // An activity deleted between fetch and recording has nothing to back off.
  await ingestion.recordDetailFailures([
    { activityId: id(ATHLETE, 999), code: 'upstream_error' },
  ]);

  // The worker records real failures through the same repository.
  const enrichment = await updateIncompleteActivities(ATHLETE, 'token', 10, {
    ingestion,
    fetchActivities: async ({ activityIds }) => ({
      activities: [],
      photos: [],
      notFoundIds: [],
      failures: (activityIds ?? []).map((activityId) => ({
        activityId,
        error: new StravaApiError('Bad gateway', 502),
      })),
    }),
  });
  assert.deepEqual(enrichment.outcome, {
    outcome: 'failed',
    reason: 'detail_failures',
  });
  // 6 is still backing off, so only 5, 7 and 8 were attempted.
  assert.equal(enrichment.failed, 3);

  // --- Outcomes keep the last success through later failures ---
  time = new Date('2026-10-05T10:00:00.000Z');
  await ingestion.recordOutcome(USER, 'details', { outcome: 'succeeded', reason: null });
  time = new Date('2026-10-05T11:00:00.000Z');
  await ingestion.recordOutcome(USER, 'details', {
    outcome: 'partial',
    reason: 'detail_failures',
  });
  const [outcome] = await testDb
    .select()
    .from(ingestionOutcomes)
    .where(eq(ingestionOutcomes.userId, USER));
  assert.equal(outcome?.outcome, 'partial');
  assert.equal(outcome?.lastAttemptAt.toISOString(), '2026-10-05T11:00:00.000Z');
  assert.equal(outcome?.lastSucceededAt?.toISOString(), '2026-10-05T10:00:00.000Z');

  // --- Heartbeats ---
  time = new Date('2026-10-05T11:37:00.000Z');
  await ingestion.startJob('reconcile-strava-summaries');
  time = new Date('2026-10-05T11:37:40.000Z');
  await ingestion.finishJob('reconcile-strava-summaries', {
    status: 'completed',
    stopReason: 'time_budget',
  });
  await ingestion.startJob('sync-activities');
  const jobs = await testDb.select().from(backgroundJobRuns);
  const reconcile = jobs.find((job) => job.job === 'reconcile-strava-summaries');
  assert.equal(reconcile?.lastStatus, 'completed');
  assert.equal(reconcile?.lastStopReason, 'time_budget');
  assert.equal(reconcile?.lastCompletedAt?.toISOString(), '2026-10-05T11:37:40.000Z');
  assert.equal(jobs.find((job) => job.job === 'sync-activities')?.lastStatus, 'running');

  // --- Account-scoped snapshot ---
  await testDb.insert(stravaSummaryReconciliations).values({
    athleteId: ATHLETE,
    scanStartedAt: new Date('2026-10-05T11:00:00.000Z'),
    scanBefore: 1_790_000_000,
    nextPage: 3,
  });
  time = new Date('2026-10-05T12:00:00.000Z');
  const snapshot = await statusRepository.snapshot(USER, ATHLETE, clock());

  assert.equal(snapshot.account.connected, true);
  assert.equal(snapshot.account.streamCredentialsBlocked, false);
  assert.equal(
    snapshot.history.lastSummaryReconciledAt?.toISOString(),
    '2026-10-03T12:00:00.000Z',
  );
  assert.deepEqual(snapshot.history.scan, {
    phase: 'scanning',
    nextPage: 3,
    scanStartedAt: new Date('2026-10-05T11:00:00.000Z'),
  });
  assert.deepEqual(snapshot.activities, {
    total: 8,
    oldestStartDate: new Date('2021-01-01T08:00:00.000Z'),
    newestStartDate: new Date('2028-01-01T08:00:00.000Z'),
    detailed: 4,
    neverDetailed: 3,
    invalidated: 1,
    detailRetryWaiting: 4,
    detailNextRetryAt: new Date('2026-10-05T14:00:00.000Z'),
  });
  assert.deepEqual(snapshot.photos, {
    activitiesWithPhotos: 3,
    activitiesWithStoredPhotos: 2,
    current: 1,
    refreshRequired: 1,
    unknown: 1,
    photoCount: 3,
  });
  assert.deepEqual(snapshot.streams, {
    withData: 2,
    withoutData: 1,
    chartSummaries: 1,
    failed: 1,
    waiting: 1,
    // 4 invalidated, 7 and 8 never fetched
    runnable: 3,
    invalidated: 1,
    nextRetryAt: new Date('2026-10-05T14:00:00.000Z'),
  });
  assert.equal(snapshot.outcomes.details?.outcome, 'partial');
  assert.equal(snapshot.outcomes.history, undefined);
  assert.equal(snapshot.jobs['reconcile-strava-summaries']?.lastStatus, 'completed');

  const status = ingestionStatusDTOSchema.parse(
    deriveIngestionStatus(snapshot, { streamBackfillEnabled: true }),
  );
  assert.equal(status.history.knownActivityCount, 8);
  assert.equal(status.history.reconciliation.pagesScanned, 2);
  assert.equal(status.details.scheduling, 'waiting');
  assert.equal(status.details.retryAt, '2026-10-05T14:00:00.000Z');
  assert.equal(status.streams.scheduling, 'unknown', 'backfill has never reported');

  // A stream credential rejection blocks only while the grant is unchanged.
  const [fingerprint] = await client<{ value: string }[]>`
    select concat_ws('|', "accessTokenExpiresAt", "expiresAt", expires_at, "updatedAt") as value
    from account where id = 'ingestion-proof-account'`;
  await testDb.insert(streamBackfillAccounts).values({
    userId: USER,
    lastSelectedAt: clock(),
    blockedCredentials: fingerprint!.value,
  });
  assert.equal(
    (await statusRepository.snapshot(USER, ATHLETE, clock())).account
      .streamCredentialsBlocked,
    true,
  );
  await testDb
    .update(accounts)
    .set({ updatedAt: new Date('2026-10-05T11:59:00.000Z') })
    .where(eq(accounts.id, 'ingestion-proof-account'));
  assert.equal(
    (await statusRepository.snapshot(USER, ATHLETE, clock())).account
      .streamCredentialsBlocked,
    false,
    'reconnecting changes the fingerprint and lifts the block',
  );

  // --- Isolation: other accounts see only their own work ---
  const other = await statusRepository.snapshot(OTHER, OTHER_ATHLETE, clock());
  assert.equal(other.activities.total, 2);
  assert.equal(other.photos.photoCount, 1);
  assert.equal(other.photos.activitiesWithStoredPhotos, 1);
  assert.equal(other.outcomes.details, undefined);
  assert.equal(other.history.scan, null);
  const revoked = await statusRepository.snapshot(REVOKED, REVOKED_ATHLETE, clock());
  assert.equal(revoked.account.connected, false);
  assert.equal(
    deriveIngestionStatus(revoked, { streamBackfillEnabled: true }).details
      .schedulingReason,
    'credentials_unavailable',
  );

  // --- Deleting an activity removes its retry state ---
  await testDb.delete(activities).where(eq(activities.id, id(ATHLETE, 6)));
  assert.equal(
    (
      await testDb
        .select()
        .from(activityDetailAttempts)
        .where(eq(activityDetailAttempts.activityId, id(ATHLETE, 6)))
    ).length,
    0,
  );
}

try {
  await run();
  console.log('Ingestion status PostgreSQL proof passed.');
} finally {
  await cleanup();
  await client.end({ timeout: 5 });
}
