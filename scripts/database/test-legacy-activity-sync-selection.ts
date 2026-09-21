import assert from 'node:assert/strict';

import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling.ts';
import { accounts, users } from '../../src/server/db/schema.ts';
import { createLegacyActivitySyncRepository } from '../../src/server/repositories/legacy-activity-sync.ts';

const environment = process.env;
const target = resolveMigrationTarget(environment);
if (
  !target.isLocal ||
  environment.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'The legacy activity-sync selection proof may only modify a guarded local *_test database',
  );
}

const client = postgres(target.connectionString, {
  max: 2,
  onnotice: () => undefined,
  prepare: false,
});
const testDb = drizzle(client);
const repository = createLegacyActivitySyncRepository(
  testDb as unknown as Parameters<typeof createLegacyActivitySyncRepository>[0],
);

const ACTIVE_USER_ID = 'legacy-sync-proof-active';
const REVOKED_USER_ID = 'legacy-sync-proof-revoked';
const OTHER_PROVIDER_USER_ID = 'legacy-sync-proof-other-provider';
const NO_ATHLETE_USER_ID = 'legacy-sync-proof-no-athlete';
const USER_IDS = [
  ACTIVE_USER_ID,
  REVOKED_USER_ID,
  OTHER_PROVIDER_USER_ID,
  NO_ATHLETE_USER_ID,
];

async function cleanup(): Promise<void> {
  await testDb.delete(users).where(inArray(users.id, USER_IDS));
}

async function seed(): Promise<void> {
  await testDb.insert(users).values([
    { id: ACTIVE_USER_ID, athlete_id: 9_201_001 },
    { id: REVOKED_USER_ID, athlete_id: 9_201_002 },
    { id: OTHER_PROVIDER_USER_ID, athlete_id: 9_201_003 },
    { id: NO_ATHLETE_USER_ID, athlete_id: null },
  ]);
  await testDb.insert(accounts).values([
    {
      id: 'legacy-sync-proof-active-account',
      userId: ACTIVE_USER_ID,
      providerId: 'strava',
      accountId: '9201001',
      accessToken: 'active-proof-token',
    },
    {
      id: 'legacy-sync-proof-revoked-account',
      userId: REVOKED_USER_ID,
      providerId: 'strava',
      accountId: '9201002',
      revokedAt: new Date('2026-09-20T00:00:00.000Z'),
    },
    {
      id: 'legacy-sync-proof-other-provider-account',
      userId: OTHER_PROVIDER_USER_ID,
      providerId: 'example-provider',
      accountId: '9201003',
      revokedAt: new Date('2026-09-20T00:00:00.000Z'),
    },
    {
      id: 'legacy-sync-proof-no-athlete-account',
      userId: NO_ATHLETE_USER_ID,
      providerId: 'strava',
      accountId: '9201004',
      accessToken: 'no-athlete-proof-token',
    },
  ]);
}

async function run(): Promise<void> {
  await verifyConnectedTarget(client, target);
  await cleanup();
  await seed();

  const candidates = await repository.listEligibleUsers();
  const fixtureCandidateIds = candidates
    .map((candidate) => candidate.id)
    .filter((id) => USER_IDS.includes(id))
    .sort();

  assert.deepEqual(
    fixtureCandidateIds,
    [ACTIVE_USER_ID, OTHER_PROVIDER_USER_ID].sort(),
    'only athlete-linked users without a revoked Strava account may be selected',
  );
}

try {
  await run();
  console.log('Legacy activity-sync PostgreSQL selection proof passed.');
} finally {
  await cleanup();
  await client.end({ timeout: 5 });
}
