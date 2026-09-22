import assert from 'node:assert/strict';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resolveMigrationTarget } from '../../src/server/db/migration-tooling';
import {
  accounts,
  activities,
  activityStreams,
  users,
} from '../../src/server/db/schema';
import {
  createActivityStreamsRepository,
  ActivityStreamsUnavailableError,
} from '../../src/server/repositories/activity-streams';
import { fetchActivityStreams } from '../../src/server/application/activity-streams';
import { StravaApiError } from '../../src/server/strava/client';
import { RAW_STREAMS_FIXTURE } from '../../src/server/strava/streams.fixture';
import type { Actor } from '../../src/server/auth/actor';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'Stream proofs may only modify a guarded local *_test database',
  );
}
const client = postgres(target.connectionString, {
  max: 4,
  prepare: false,
  onnotice: () => undefined,
});
const testDb = drizzle(client);
const repository = createActivityStreamsRepository(
  testDb as unknown as Parameters<typeof createActivityStreamsRepository>[0],
);
const NOW = new Date('2026-09-22T12:00:00Z');
const actor: Actor = {
  userId: 'streams-proof-user',
  athleteId: 9182001,
  authentication: 'bearer',
};
const other: Actor = {
  userId: 'streams-proof-other',
  athleteId: 9182002,
  authentication: 'cookie',
};
const ID = '9007199254740993';
const accountId = `${actor.userId}-account`;
const activityWhere = eq(activities.id, sql`${ID}::bigint`);
const credentials = {
  accessToken: 'proof-access',
  refreshToken: 'proof-refresh',
  accessTokenExpiresAt: new Date('2030-01-01'),
};
const refreshed = {
  access_token: 'refreshed-access',
  refresh_token: 'refreshed-refresh',
  expires_at: 2_000_000_000,
  expires_in: 21600,
};

async function cleanup() {
  await testDb.delete(users).where(eq(users.id, actor.userId));
  await testDb.delete(users).where(eq(users.id, other.userId));
}
async function seedActivity() {
  await testDb.insert(activities).values({
    id: sql`${ID}::bigint`,
    public_id: 9182100,
    athlete: actor.athleteId,
    name: 'Raw streams fixture',
    sport_type: 'Ride',
    start_date: NOW,
    start_date_local: NOW,
    timezone: 'UTC',
    geometryState: 'summary',
  });
}
async function claim() {
  const result = await repository.begin(actor, ID, NOW, true);
  assert.equal(result.kind, 'fetch');
  if (result.kind !== 'fetch') throw new Error('Expected fetch');
  return result.claim;
}
const options = {
  repository,
  now: () => NOW,
  createSource: () => ({
    async getActivityStreams(id: string) {
      assert.equal(id, ID);
      return RAW_STREAMS_FIXTURE;
    },
  }),
};

async function run() {
  await cleanup();
  for (const owner of [actor, other]) {
    await testDb
      .insert(users)
      .values({ id: owner.userId, athlete_id: owner.athleteId });
    await testDb
      .insert(accounts)
      .values({
        id: `${owner.userId}-account`,
        userId: owner.userId,
        accountId: String(owner.athleteId),
        providerId: 'strava',
        ...credentials,
      });
  }
  await seedActivity();
  assert.equal(
    await repository.read(actor, ID),
    null,
    'no row means never attempted',
  );

  // Cross-user access fails before any source is constructed, even if an Actor
  // tries to combine one user's id with the other's athlete id.
  for (const caller of [other, { ...other, athleteId: actor.athleteId }]) {
    await assert.rejects(
      fetchActivityStreams(caller, ID, {
        ...options,
        createSource: () => {
          throw new Error('must not fetch');
        },
      }),
      ActivityStreamsUnavailableError,
    );
    await assert.rejects(
      repository.read(caller, ID),
      ActivityStreamsUnavailableError,
    );
  }

  const result = await fetchActivityStreams(actor, ID, options);
  assert.equal(result.status, 'fetched');
  const first = await repository.read(actor, ID);
  assert.equal(first?.activityId, ID);
  assert.equal(first?.revision, '1');
  assert.deepEqual(first?.payload, RAW_STREAMS_FIXTURE);
  assert.equal(first?.fetchedAt?.toISOString(), NOW.toISOString());
  assert.deepEqual(first?.requestedTypes, [
    'time',
    'distance',
    'latlng',
    'altitude',
    'watts',
    'heartrate',
  ]);
  const cached = await fetchActivityStreams(actor, ID, {
    ...options,
    createSource: () => {
      throw new Error('must use stored payload');
    },
  });
  assert.equal(cached.status, 'cached');
  assert.equal((await repository.read(actor, ID))?.revision, '1');

  // Failed attempts retain all six streams and the last successful timestamp.
  await assert.rejects(
    fetchActivityStreams(actor, ID, {
      ...options,
      force: true,
      createSource: () => ({
        async getActivityStreams() {
          throw new StravaApiError('rate limited', 429);
        },
      }),
    }),
    StravaApiError,
  );
  const failed = await repository.read(actor, ID);
  assert.deepEqual(failed?.payload, first?.payload);
  assert.equal(failed?.revision, '1');
  assert.deepEqual(failed?.fetchedAt, first?.fetchedAt);
  assert.equal(failed?.lastAttemptStatus, 'failed');
  assert.deepEqual(failed?.lastError, {
    code: 'rate_limited',
    retryable: true,
  });

  const malformed = await claim();
  await assert.rejects(
    repository.commit(
      malformed,
      { ...RAW_STREAMS_FIXTURE, watts: { data: ['bad'] } },
      NOW,
    ),
  );
  assert.equal((await repository.read(actor, ID))?.revision, '1');

  // An actual PostgreSQL failure after UPDATE must roll back payload + metadata.
  const rollbackClaim = await claim();
  const beforeRollback = await repository.read(actor, ID);
  await client.unsafe(`CREATE FUNCTION stream_proof_reject() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.activity_id = ${ID} AND NEW.revision > OLD.revision THEN
      RAISE EXCEPTION 'injected stream write failure'; END IF; RETURN NEW; END $$`);
  await client.unsafe(
    'CREATE TRIGGER stream_proof_reject AFTER UPDATE ON activity_streams FOR EACH ROW EXECUTE FUNCTION stream_proof_reject()',
  );
  try {
    await assert.rejects(repository.commit(rollbackClaim, {}, NOW));
    assert.deepEqual(await repository.read(actor, ID), beforeRollback);
  } finally {
    await client.unsafe('DROP TRIGGER stream_proof_reject ON activity_streams');
    await client.unsafe('DROP FUNCTION stream_proof_reject()');
  }

  // Empty/partial success is durable; absence does not become synthetic zeroes.
  const empty = await repository.commit(rollbackClaim, {}, NOW);
  assert.deepEqual(empty?.payload, {});
  assert.equal(empty?.revision, '2');
  assert.equal(
    await repository.commit(rollbackClaim, RAW_STREAMS_FIXTURE, NOW),
    null,
    'replay cannot increment revision',
  );
  assert.equal(
    (
      await fetchActivityStreams(actor, ID, {
        ...options,
        createSource: () => {
          throw new Error('empty success is cached');
        },
      })
    ).status,
    'cached',
  );
  const partial = {
    time: RAW_STREAMS_FIXTURE.time,
    altitude: RAW_STREAMS_FIXTURE.altitude,
  };
  assert.deepEqual(
    (await repository.commit(await claim(), partial, NOW))?.payload,
    partial,
  );

  // A newer claim wins even if the older request returns later.
  const overlapping = await Promise.all([claim(), claim()]);
  const currentAttempt = (await repository.read(actor, ID))?.attemptId;
  const newer = overlapping.find((item) => item.attemptId === currentAttempt)!;
  const older = overlapping.find((item) => item !== newer)!;
  assert.equal(await repository.commit(older, {}, NOW), null);
  assert.ok(await repository.commit(newer, RAW_STREAMS_FIXTURE, NOW));
  assert.equal(
    await repository.fail(older, { code: 'upstream_error', retryable: true }),
    false,
  );

  // The service discards responses if a source update occurs during the fetch.
  const beforeChange = await repository.read(actor, ID);
  assert.equal(
    (
      await fetchActivityStreams(actor, ID, {
        ...options,
        force: true,
        createSource: () => ({
          async getActivityStreams() {
            await testDb
              .update(activities)
              .set({ name: 'Changed during fetch' })
              .where(activityWhere);
            return {};
          },
        }),
      })
    ).status,
    'superseded',
  );
  assert.deepEqual(
    (await repository.read(actor, ID))?.payload,
    beforeChange?.payload,
  );
  assert.equal(
    (await fetchActivityStreams(actor, ID, options)).status,
    'fetched',
    'source change defeats cache',
  );

  // The application service carries the new credential generation into commit.
  assert.equal(
    (
      await fetchActivityStreams(actor, ID, {
        ...options,
        force: true,
        createSource: ({ onRefresh }) => ({
          async getActivityStreams() {
            await onRefresh(refreshed);
            return RAW_STREAMS_FIXTURE;
          },
        }),
      })
    ).status,
    'fetched',
  );
  const [refreshedAccount] = await testDb
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));
  assert.equal(refreshedAccount?.accessToken, refreshed.access_token);
  assert.equal(refreshedAccount?.access_token, refreshed.access_token);
  assert.equal(refreshedAccount?.refreshToken, refreshed.refresh_token);
  assert.equal(refreshedAccount?.refresh_token, refreshed.refresh_token);

  // Guard token refresh and deauthorization at the same persistence boundary.
  let refreshClaim = await claim();
  const current = await repository.replaceCredentials(refreshClaim, {
    ...refreshed,
    access_token: 'next-access',
  });
  assert.ok(current);
  assert.equal(
    await repository.commit(refreshClaim, {}, NOW),
    null,
    'old credential generation rejected',
  );
  assert.ok(await repository.commit(current, RAW_STREAMS_FIXTURE, NOW));

  // Strava rotates the refresh token on use, so a superseded attempt must
  // still persist it; otherwise the stored refresh token is already dead.
  refreshClaim = await claim();
  await testDb
    .update(activities)
    .set({ elapsed_time: 4321 })
    .where(activityWhere);
  assert.equal(
    await repository.replaceCredentials(refreshClaim, {
      ...refreshed,
      access_token: 'superseded-access',
      refresh_token: 'superseded-refresh',
    }),
    null,
    'superseded claim is not revived',
  );
  const [afterSuperseded] = await testDb
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));
  assert.equal(afterSuperseded?.refreshToken, 'superseded-refresh');
  assert.equal(afterSuperseded?.refresh_token, 'superseded-refresh');
  // A claim from before another writer's refresh never overwrites newer tokens.
  assert.equal(
    await repository.replaceCredentials(refreshClaim, {
      ...refreshed,
      refresh_token: 'stale-refresh',
    }),
    null,
  );
  assert.equal(
    (await testDb.select().from(accounts).where(eq(accounts.id, accountId)))[0]
      ?.refreshToken,
    'superseded-refresh',
  );

  refreshClaim = await claim();
  await testDb
    .update(accounts)
    .set({
      revokedAt: NOW,
      scheduledErasureAt: NOW,
      accessToken: null,
      access_token: null,
      refreshToken: null,
      refresh_token: null,
    })
    .where(eq(accounts.id, accountId));
  assert.equal(
    await repository.replaceCredentials(refreshClaim, refreshed),
    null,
  );
  assert.equal(await repository.commit(refreshClaim, {}, NOW), null);
  await assert.rejects(
    fetchActivityStreams(actor, ID, options),
    ActivityStreamsUnavailableError,
  );
  const [revoked] = await testDb
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));
  assert.equal(revoked?.accessToken, null);
  await testDb
    .update(accounts)
    .set({ revokedAt: null, scheduledErasureAt: null, ...credentials })
    .where(eq(accounts.id, accountId));
  assert.equal(
    await repository.commit(refreshClaim, {}, NOW),
    null,
    'reauthorization cannot revive old claims',
  );

  const deletedClaim = await claim();
  await testDb.delete(activities).where(activityWhere);
  assert.equal(
    (
      await testDb
        .select()
        .from(activityStreams)
        .where(eq(activityStreams.activityId, BigInt(ID)))
    ).length,
    0,
  );
  assert.equal(
    await repository.commit(deletedClaim, RAW_STREAMS_FIXTURE, NOW),
    null,
  );
  await seedActivity();
  await assert.rejects(
    fetchActivityStreams(actor, ID, {
      ...options,
      createSource: () => ({
        async getActivityStreams() {
          throw new StravaApiError('not found', 404);
        },
      }),
    }),
    StravaApiError,
  );
  const noPayload = await repository.read(actor, ID);
  assert.equal(noPayload?.payload, null);
  assert.equal(noPayload?.fetchedAt, null);
  assert.equal(noPayload?.revision, '0');
  assert.equal(noPayload?.lastAttemptStatus, 'failed');
  assert.deepEqual(noPayload?.lastError, {
    code: 'not_found',
    retryable: false,
  });
  const recreated = await claim();
  assert.notEqual(recreated.generation, deletedClaim.generation);
  assert.equal(
    await repository.commit(deletedClaim, RAW_STREAMS_FIXTURE, NOW),
    null,
  );
  assert.ok(await repository.commit(recreated, RAW_STREAMS_FIXTURE, NOW));
  await testDb
    .delete(users)
    .where(
      and(eq(users.id, actor.userId), eq(users.athlete_id, actor.athleteId)),
    );
  assert.equal(
    (
      await testDb
        .select()
        .from(activityStreams)
        .where(eq(activityStreams.activityId, BigInt(ID)))
    ).length,
    0,
    'account erasure cascades streams',
  );
}

try {
  await run();
  console.log('Activity streams PostgreSQL proof passed.');
} finally {
  await cleanup();
  await client.end({ timeout: 5 });
}
