import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import {
  users,
  accounts,
  activities,
  activityDetailAttempts,
  stravaImportRuns,
} from '../../src/server/db/schema';
import { createStravaImportRepository } from '../../src/server/repositories/strava-import';
import type { Actor } from '../../src/server/auth/actor';
const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  !target.database.endsWith('_test') ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true'
)
  throw new Error('Requires guarded local *_test database');
const client = postgres(target.connectionString, { max: 6, prepare: false });
const database = drizzle(client);
let time = Date.parse('2026-10-17T10:00:00Z');
const repository = createStravaImportRepository(
  database as unknown as Parameters<typeof createStravaImportRepository>[0],
  () => new Date(time),
);
const actor: Actor = {
  userId: 'manual-proof-user',
  athleteId: 9179876,
  authentication: 'cookie',
};
const other: Actor = {
  ...actor,
  userId: 'manual-proof-other',
  athleteId: 9179877,
};
async function seed() {
  for (const identity of [actor, other]) {
    await database
      .insert(users)
      .values({
        id: identity.userId,
        athlete_id: identity.athleteId,
        name: 'Manual import proof',
        email: `${identity.userId}@example.test`,
      });
    await database
      .insert(accounts)
      .values({
        id: `${identity.userId}-account`,
        userId: identity.userId,
        providerId: 'strava',
        accountId: String(identity.athleteId),
        scope: 'activity:read_all',
        accessToken: 'proof-access',
        refreshToken: 'proof-refresh',
        accessTokenExpiresAt: new Date(time + 3_600_000),
      });
  }
}
try {
  await verifyConnectedTarget(client, target);
  await seed();
  assert.equal((await repository.read(actor, true)).status, 'idle');
  const started = await Promise.all([
    repository.start(actor),
    repository.start(actor),
  ]);
  const claims = started.flatMap((run) => (run?.claim ? [run.claim] : []));
  assert.equal(claims.length, 1, 'concurrent clicks across devices start once');
  const claim = claims[0]!;
  assert.ok(started.every((run) => run?.status.runId === claim.runId));
  assert.equal(
    (await repository.read(other, true)).runId,
    null,
    'status isolated by user',
  );
  assert.equal(
    await repository.start({ ...actor, athleteId: other.athleteId }),
    null,
  );
  const progress = {
    summaries: 800,
    details: 5,
    photos: 7,
    requests: 19,
    cursor: { before: 1_700_000_000, page: 4, done: false },
  };
  await repository.save(claim, progress, {
    status: 'succeeded',
    reason: 'complete',
  });
  assert.equal(
    (await repository.start(actor))?.claim,
    null,
    'cooldown survives completion',
  );
  time += 5 * 60_000;
  const second = (await repository.start(actor))!.claim!;
  assert.deepEqual(
    second.cursor,
    progress.cursor,
    'history continues beyond the saved pages',
  );
  await repository.save(
    claim,
    { ...progress, summaries: 9999 },
    { status: 'failed', reason: 'internal_error' },
  );
  assert.equal(
    (await repository.read(actor, true)).summaries,
    0,
    'old run cannot overwrite new status',
  );
  time += 91_000;
  assert.equal((await repository.read(actor, true)).status, 'interrupted');
  await repository.save(second, progress);
  assert.equal(
    (await repository.read(actor, true)).summaries,
    0,
    'expired worker cannot checkpoint',
  );
  time += 5 * 60_000;
  const third = (await repository.start(actor))!.claim!;
  assert.equal(
    await repository.replaceCredentials(third, 'wrong-token', {
      access_token: 'new',
      refresh_token: 'new-refresh',
      expires_at: time / 1000 + 3600,
      expires_in: 3600,
    }),
    false,
  );
  assert.equal(
    await repository.replaceCredentials(third, 'proof-access', {
      access_token: 'new',
      refresh_token: 'new-refresh',
      expires_at: time / 1000 + 3600,
      expires_in: 3600,
    }),
    true,
  );
  await database.insert(activities).values([
    {
      id: 917987600,
      public_id: 917987600,
      athlete: actor.athleteId,
      name: 'Pending detail',
      sport_type: 'Run',
      geometryState: 'summary',
      photosState: 'current',
      start_date: new Date(time),
      start_date_local: new Date(time),
      timezone: 'UTC',
    },
    {
      id: 917987601,
      public_id: 917987601,
      athlete: actor.athleteId,
      name: 'Legacy photos',
      sport_type: 'Run',
      geometryState: 'detailed',
      photosState: null,
      total_photo_count: 0,
      photo_count: 1,
      start_date: new Date(time),
      start_date_local: new Date(time),
      timezone: 'UTC',
    },
  ]);
  assert.deepEqual(
    (await repository.candidates(actor.athleteId, 5)).sort(),
    [917987600, 917987601],
  );
  await database
    .insert(activityDetailAttempts)
    .values({
      activityId: 917987600,
      attemptCount: 1,
      lastAttemptAt: new Date(time),
      nextAttemptAt: new Date(time + 3_600_000),
      lastErrorCode: 'upstream_error',
    });
  assert.deepEqual(
    await repository.candidates(actor.athleteId, 5),
    [917987601],
    'manual fetch honors activity backoff',
  );
  await database
    .update(accounts)
    .set({ revokedAt: new Date(time) })
    .where(eq(accounts.id, third.accountId));
  assert.equal(await repository.isCurrent(third), false);
  assert.equal((await repository.read(actor, true)).available, false);
  await repository.save(third, progress);
  const [revokedRun] = await database
    .select()
    .from(stravaImportRuns)
    .where(eq(stravaImportRuns.userId, actor.userId));
  assert.equal(revokedRun?.summaries, 0, 'revoked grant cannot publish status');
  await database.delete(accounts).where(eq(accounts.id, third.accountId));
  assert.equal(
    (
      await database
        .select()
        .from(stravaImportRuns)
        .where(eq(stravaImportRuns.userId, actor.userId))
    ).length,
    0,
    'account erasure cascades run metadata',
  );
  console.log(
    'Manual import proof passed: concurrent starts, account isolation, cooldown, checkpoints, stale leases, credentials, photo candidates, backoff and erasure.',
  );
} finally {
  await database.delete(users).where(eq(users.id, actor.userId));
  await database.delete(users).where(eq(users.id, other.userId));
  await client.end();
}
