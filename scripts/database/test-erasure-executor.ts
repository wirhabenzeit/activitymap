import assert from 'node:assert/strict';

import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { resolveMigrationTarget, verifyConnectedTarget } from '../../src/server/db/migration-tooling.ts';
import {
  accounts,
  activities,
  activityDeletions,
  activitySync,
  mobileLoginCodes,
  photoDeletions,
  photos,
  sessions,
  stravaWebhookEvents,
  syncChanges,
  users,
  verification,
} from '../../src/server/db/schema.ts';
import { createErasureRepository } from '../../src/server/repositories/erasure.ts';

const environment = process.env;
const target = resolveMigrationTarget(environment);

if (
  !target.isLocal ||
  environment.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'The erasure executor proof may only modify a guarded local *_test database',
  );
}

const client = postgres(target.connectionString, {
  max: 2,
  onnotice: () => undefined,
  prepare: false,
});
const testDb = drizzle(client);
const repository = createErasureRepository(
  testDb as unknown as Parameters<typeof createErasureRepository>[0],
);

const NOW = new Date('2026-09-20T12:00:00.000Z');
const DUE_USER_ID = 'erasure-proof-due-user';
const RECONNECTED_USER_ID = 'erasure-proof-reconnected-user';
const FUTURE_USER_ID = 'erasure-proof-future-user';
const USER_IDS = [DUE_USER_ID, RECONNECTED_USER_ID, FUTURE_USER_ID];
const DUE_ATHLETE_ID = 9_001_001;
const RECONNECTED_ATHLETE_ID = 9_001_002;
const FUTURE_ATHLETE_ID = 9_001_003;
const ATHLETE_IDS = [DUE_ATHLETE_ID, RECONNECTED_ATHLETE_ID, FUTURE_ATHLETE_ID];

async function cleanup(): Promise<void> {
  await testDb
    .delete(stravaWebhookEvents)
    .where(inArray(stravaWebhookEvents.ownerId, ATHLETE_IDS));
  await testDb
    .delete(activityDeletions)
    .where(inArray(activityDeletions.athlete_id, ATHLETE_IDS));
  await testDb
    .delete(photoDeletions)
    .where(inArray(photoDeletions.athlete_id, ATHLETE_IDS));
  await testDb
    .delete(verification)
    .where(
      inArray(verification.identifier, [
        ...USER_IDS,
        'due-athlete@strava.local',
      ]),
    );
  await testDb.delete(users).where(inArray(users.id, USER_IDS));
}

async function seed(): Promise<void> {
  await testDb.insert(users).values([
    {
      id: DUE_USER_ID,
      email: 'due-athlete@strava.local',
      athlete_id: DUE_ATHLETE_ID,
    },
    {
      id: RECONNECTED_USER_ID,
      athlete_id: RECONNECTED_ATHLETE_ID,
    },
    { id: FUTURE_USER_ID, athlete_id: FUTURE_ATHLETE_ID },
  ]);

  await testDb.insert(accounts).values([
    {
      id: 'erasure-proof-due-account',
      userId: DUE_USER_ID,
      providerId: 'strava',
      accountId: String(DUE_ATHLETE_ID),
      revokedAt: new Date('2026-08-20T00:00:00.000Z'),
      scheduledErasureAt: new Date('2026-09-19T00:00:00.000Z'),
    },
    {
      id: 'erasure-proof-reconnected-account',
      userId: RECONNECTED_USER_ID,
      providerId: 'strava',
      accountId: String(RECONNECTED_ATHLETE_ID),
      accessToken: 'fresh-token-that-must-preserve-the-user',
      revokedAt: new Date('2026-08-20T00:00:00.000Z'),
      scheduledErasureAt: new Date('2026-09-19T00:00:00.000Z'),
    },
    {
      id: 'erasure-proof-future-account',
      userId: FUTURE_USER_ID,
      providerId: 'strava',
      accountId: String(FUTURE_ATHLETE_ID),
      revokedAt: new Date('2026-09-19T00:00:00.000Z'),
      scheduledErasureAt: new Date('2026-10-19T00:00:00.000Z'),
    },
  ]);

  await testDb.insert(sessions).values({
    id: 'erasure-proof-session',
    token: 'erasure-proof-session-token',
    userId: DUE_USER_ID,
    expiresAt: new Date('2026-10-20T00:00:00.000Z'),
  });
  await testDb.insert(activitySync).values({
    id: 'erasure-proof-sync',
    user_id: DUE_USER_ID,
  });
  await testDb.insert(mobileLoginCodes).values({
    id: 'erasure-proof-mobile-code',
    codeHash: 'erasure-proof-code-hash',
    state: 'erasure-proof-state',
    pkceChallenge: 'erasure-proof-challenge',
    redirectUri: 'activitymap://oauth/callback',
    userId: DUE_USER_ID,
    expiresAt: new Date('2026-09-20T13:00:00.000Z'),
  });
  await testDb.insert(activities).values({
    id: 9_002_001,
    public_id: 9_003_001,
    athlete: DUE_ATHLETE_ID,
    name: 'Erasure proof activity',
    sport_type: 'Run',
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    start_date_local: new Date('2026-01-01T00:00:00.000Z'),
    timezone: 'UTC',
    geometryState: 'summary',
  });
  await testDb.insert(photos).values({
    unique_id: 'erasure-proof-photo',
    activity_id: 9_002_001,
    athlete_id: DUE_ATHLETE_ID,
    type: 0,
  });
  await testDb.insert(activityDeletions).values({
    athlete_id: DUE_ATHLETE_ID,
    activity_id: 9_002_002,
  });
  await testDb.insert(photoDeletions).values({
    athlete_id: DUE_ATHLETE_ID,
    photo_id: 'erasure-proof-deleted-photo',
  });
  await testDb.insert(syncChanges).values({
    athleteId: DUE_ATHLETE_ID,
    entityType: 'activity',
    entityId: '9002001',
    operation: 'upsert',
  });
  await testDb.insert(stravaWebhookEvents).values({
    id: 'erasure-proof-webhook-event',
    subscriptionId: 1,
    objectType: 'athlete',
    objectId: DUE_ATHLETE_ID,
    aspectType: 'update',
    ownerId: DUE_ATHLETE_ID,
    eventTime: new Date('2026-08-20T00:00:00.000Z'),
    payload: {
      object_type: 'athlete',
      object_id: DUE_ATHLETE_ID,
      aspect_type: 'update',
      owner_id: DUE_ATHLETE_ID,
      subscription_id: 1,
      event_time: 1_755_648_000,
    },
  });
  await testDb.insert(verification).values([
    {
      id: 'erasure-proof-verification-user',
      identifier: DUE_USER_ID,
      value: 'proof',
      expiresAt: new Date('2026-09-21T00:00:00.000Z'),
    },
    {
      id: 'erasure-proof-verification-email',
      identifier: 'due-athlete@strava.local',
      value: 'proof',
      expiresAt: new Date('2026-09-21T00:00:00.000Z'),
    },
  ]);
}

async function verifyDueAthleteWasFullyErased(): Promise<void> {
  const [counts] = await client<
    Array<{
      accounts: number;
      activities: number;
      activity_deletions: number;
      activity_sync: number;
      mobile_codes: number;
      photo_deletions: number;
      photos: number;
      sessions: number;
      sync_changes: number;
      users: number;
      verifications: number;
      webhook_events: number;
    }>
  >`
    SELECT
      (SELECT count(*)::int FROM "user" WHERE id = ${DUE_USER_ID}) AS users,
      (SELECT count(*)::int FROM account WHERE "userId" = ${DUE_USER_ID}) AS accounts,
      (SELECT count(*)::int FROM session WHERE "userId" = ${DUE_USER_ID}) AS sessions,
      (SELECT count(*)::int FROM activity_sync WHERE user_id = ${DUE_USER_ID}) AS activity_sync,
      (SELECT count(*)::int FROM mobile_login_codes WHERE user_id = ${DUE_USER_ID}) AS mobile_codes,
      (SELECT count(*)::int FROM activities WHERE athlete = ${DUE_ATHLETE_ID}) AS activities,
      (SELECT count(*)::int FROM photos WHERE athlete_id = ${DUE_ATHLETE_ID}) AS photos,
      (SELECT count(*)::int FROM sync_change WHERE athlete_id = ${DUE_ATHLETE_ID}) AS sync_changes,
      (SELECT count(*)::int FROM activity_deletions WHERE athlete_id = ${DUE_ATHLETE_ID}) AS activity_deletions,
      (SELECT count(*)::int FROM photo_deletions WHERE athlete_id = ${DUE_ATHLETE_ID}) AS photo_deletions,
      (SELECT count(*)::int FROM strava_webhook_events WHERE owner_id = ${DUE_ATHLETE_ID}) AS webhook_events,
      (SELECT count(*)::int FROM verification WHERE identifier IN (${DUE_USER_ID}, 'due-athlete@strava.local')) AS verifications
  `;

  assert.ok(counts);
  assert.deepEqual(counts, {
    accounts: 0,
    activities: 0,
    activity_deletions: 0,
    activity_sync: 0,
    mobile_codes: 0,
    photo_deletions: 0,
    photos: 0,
    sessions: 0,
    sync_changes: 0,
    users: 0,
    verifications: 0,
    webhook_events: 0,
  });
}

async function verifyReconnectedAthleteWasPreserved(): Promise<void> {
  const [account] = await testDb
    .select({
      accessToken: accounts.accessToken,
      revokedAt: accounts.revokedAt,
      scheduledErasureAt: accounts.scheduledErasureAt,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, 'erasure-proof-reconnected-account'),
        eq(accounts.userId, RECONNECTED_USER_ID),
      ),
    );

  assert.deepEqual(account, {
    accessToken: 'fresh-token-that-must-preserve-the-user',
    revokedAt: null,
    scheduledErasureAt: null,
  });
  const [user] = await testDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, RECONNECTED_USER_ID));
  assert.deepEqual(user, { id: RECONNECTED_USER_ID });
}

async function main(): Promise<void> {
  await verifyConnectedTarget(client, target);
  await cleanup();
  try {
    await seed();
    const candidates = await repository.listDue(10, NOW);
    assert.deepEqual(
      candidates.map((candidate) => candidate.accountId).sort(),
      ['erasure-proof-due-account', 'erasure-proof-reconnected-account'],
    );

    const due = candidates.find(
      (candidate) => candidate.accountId === 'erasure-proof-due-account',
    );
    const reconnected = candidates.find(
      (candidate) =>
        candidate.accountId === 'erasure-proof-reconnected-account',
    );
    assert.ok(due);
    assert.ok(reconnected);

    const overlappingResults = await Promise.all([
      repository.erase(due, NOW),
      repository.erase(due, NOW),
    ]);
    assert.deepEqual(
      overlappingResults.sort(),
      ['erased', 'stale'],
      'overlapping workers must produce one deletion and one harmless no-op',
    );
    assert.equal(await repository.erase(reconnected, NOW), 'cancelled');

    await verifyDueAthleteWasFullyErased();
    await verifyReconnectedAthleteWasPreserved();

    const remainingDue = await repository.listDue(10, NOW);
    assert.deepEqual(remainingDue, []);
    console.log('Erasure executor PostgreSQL proof passed.');
  } finally {
    await cleanup();
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Erasure executor proof failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
