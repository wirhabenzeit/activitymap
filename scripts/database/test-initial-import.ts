import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import {
  accounts,
  activities,
  initialActivityImports,
  syncChanges,
  users,
} from '../../src/server/db/schema';
import { createInitialImportRepository } from '../../src/server/repositories/initial-import';
import { presentInitialImport } from '../../src/server/application/initial-import';
import type { StravaActivity } from '../../src/server/strava/types';
import { transformStravaActivity } from '../../src/server/strava/transforms';

const target = resolveMigrationTarget(process.env);
assert(
  target.isLocal &&
    target.database.endsWith('_test') &&
    process.env.MIGRATION_REQUIRE_TARGET_GUARDS === 'true',
  'Only guarded local *_test databases are allowed',
);
const client = postgres(target.connectionString, {
  max: 4,
  prepare: false,
  onnotice: () => undefined,
});
await verifyConnectedTarget(client, target);
const testDb = drizzle(client);
const repository = createInitialImportRepository(
  testDb as unknown as Parameters<typeof createInitialImportRepository>[0],
);
const ATHLETE_ID = 9_370_001;
const LEGACY_ATHLETE = 9_370_002;
const NOW = new Date('2026-10-10T12:00:00Z');
const actor = {
  userId: 'initial-import-proof',
  athleteId: ATHLETE_ID,
  authentication: 'bearer' as const,
};
const userIds = [actor.userId, 'initial-import-legacy-proof'];
const ids = Array.from({ length: 201 }, (_, i) => 9_370_000_000 + i);
async function cleanup() {
  await testDb.delete(users).where(inArray(users.id, userIds));
  await testDb.delete(activities).where(inArray(activities.id, ids));
  await testDb
    .delete(syncChanges)
    .where(inArray(syncChanges.athleteId, [ATHLETE_ID, LEGACY_ATHLETE]));
}
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
      firstname: 'Ada',
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
    name: `Activity ${id}`,
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
    upload_id: id + 1000,
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

try {
  await cleanup();
  await testDb
    .insert(users)
    .values({ id: userIds[1]!, athlete_id: LEGACY_ATHLETE });
  // Exercise the actual rollout statement against an existing account.
  const migration = await readFile(
    new URL('../../drizzle/0022_initial-activity-import.sql', import.meta.url),
    'utf8',
  );
  await client.unsafe(migration.slice(migration.indexOf('INSERT INTO')));
  const legacy = await repository.read({
    ...actor,
    userId: userIds[1]!,
    athleteId: LEGACY_ATHLETE,
  });
  assert(legacy?.completedAt && legacy.startedAt === null);
  assert.equal(presentInitialImport(legacy, NOW).phase, 'ready');

  await testDb
    .insert(users)
    .values({ id: actor.userId, athlete_id: ATHLETE_ID });
  await testDb
    .insert(accounts)
    .values({
      id: 'initial-import-proof-account',
      userId: actor.userId,
      providerId: 'strava',
      accountId: String(ATHLETE_ID),
      accessToken: 'test-only',
    });
  assert.equal(await repository.read(actor), null);
  const claims = await Promise.all([
    repository.claim(actor, NOW),
    repository.claim(actor, NOW),
  ]);
  assert.equal(
    claims.filter(Boolean).length,
    1,
    'concurrent clients share one lease',
  );
  const first = claims.find(Boolean)!;
  const page = (start: number, count = 50) =>
    Array.from({ length: count }, (_, i) => stravaActivity(ids[start + i]!));
  await repository.commit(actor, first, page(0), NOW);
  assert.equal((await repository.read(actor))?.importedCount, 50);
  assert.equal(
    (
      await testDb
        .select()
        .from(activities)
        .where(eq(activities.athlete, ATHLETE_ID))
    ).length,
    50,
  );
  await assert.rejects(repository.commit(actor, first, page(0), NOW), /lease/);
  assert.equal(
    (
      await testDb
        .select()
        .from(syncChanges)
        .where(eq(syncChanges.athleteId, ATHLETE_ID))
    ).length,
    50,
  );

  const second = (await repository.claim(actor, NOW))!;
  await testDb
    .update(accounts)
    .set({ revokedAt: NOW })
    .where(eq(accounts.userId, actor.userId));
  await assert.rejects(
    repository.commit(actor, second, page(50), NOW),
    /account changed/,
  );
  assert.equal((await repository.read(actor))?.importedCount, 50);
  await testDb
    .update(accounts)
    .set({ revokedAt: null })
    .where(eq(accounts.userId, actor.userId));
  await repository.fail(
    actor,
    second,
    'Rate limited',
    new Date(NOW.getTime() + 3600_000),
  );
  assert.equal(
    await repository.claim(actor, NOW),
    null,
    'server cooldown applies across devices',
  );
  const later = new Date(NOW.getTime() + 3601_000);
  const resumed = (await repository.claim(actor, later))!;
  assert.equal(resumed.nextPage, 2);
  assert.equal(resumed.before, first.before);
  await assert.rejects(
    repository.commit(
      actor,
      resumed,
      [
        stravaActivity(ids[50]!, {
          athlete: { ...stravaActivity(1).athlete, id: LEGACY_ATHLETE },
        }),
      ],
      later,
    ),
    /Invalid/,
  );
  assert.equal((await repository.read(actor))?.importedCount, 50);
  await repository.commit(actor, resumed, page(50), later);

  // Existing detail data is never replaced by a late summary seed.
  // Seed one overlapping row as a concurrent webhook/detail import would.
  await testDb
    .insert(activities)
    .values({
      ...transformStravaActivity(stravaActivity(ids[100]!), true),
      athlete: ATHLETE_ID,
      description: 'Authoritative detail',
      map_polyline: 'full-route',
    });
  const third = (await repository.claim(actor, later))!;
  await repository.commit(actor, third, page(100), later);
  const [retained] = await testDb
    .select()
    .from(activities)
    .where(eq(activities.id, ids[100]!));
  assert.equal(retained!.description, 'Authoritative detail');
  assert.equal(retained!.map_polyline, 'full-route');
  const fourth = (await repository.claim(actor, later))!;
  await repository.commit(actor, fourth, page(150), later);
  assert.equal((await repository.read(actor))?.importedCount, 200);
  assert.equal(
    await repository.claim(actor, later),
    null,
    'completed accounts cannot fetch another page',
  );
  assert.equal(
    (
      await testDb
        .select()
        .from(activities)
        .where(eq(activities.athlete, ATHLETE_ID))
    ).length,
    200,
  );

  // Expired owners cannot advance a new owner's page or clear its lease.
  await testDb
    .delete(initialActivityImports)
    .where(eq(initialActivityImports.userId, actor.userId));
  const expired = (await repository.claim(actor, NOW))!;
  const afterExpiry = new Date(NOW.getTime() + 91_000);
  const replacement = (await repository.claim(actor, afterExpiry))!;
  await assert.rejects(
    repository.commit(actor, expired, [], afterExpiry),
    /lease/,
  );
  await repository.fail(actor, expired, 'late failure', null);
  assert.equal(
    (await repository.read(actor))?.leaseToken,
    replacement.leaseToken,
  );
  await repository.commit(actor, replacement, [], afterExpiry);
  assert.equal(
    presentInitialImport(await repository.read(actor), afterExpiry).phase,
    'empty',
  );
  const [user] = await testDb
    .select()
    .from(users)
    .where(eq(users.id, actor.userId));
  assert.equal(user!.oldest_activity_reached, true);
  await testDb.delete(users).where(eq(users.id, actor.userId));
  assert.equal(
    await repository.read(actor),
    null,
    'account deletion removes the checkpoint',
  );
  console.log(
    'INITIAL_IMPORT_DATABASE_PROOF_PASSED: rollout, concurrent leases, atomic page/feed, retry, ownership, revocation, detail preservation, completion, late responses and cascade cleanup',
  );
} finally {
  await cleanup();
  await client.end({ timeout: 5 });
}
