import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

import {
  loadMigrationDescriptors,
  MIGRATIONS_FOLDER,
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling.ts';
import { runMigrationOperation } from './migrate.ts';

const environment = process.env;
const target = resolveMigrationTarget(environment);

if (
  !target.isLocal ||
  environment.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'The webhook migration fixture may only reset a guarded local *_test database',
  );
}

const client = postgres(target.connectionString, {
  max: 1,
  onnotice: () => undefined,
  prepare: false,
});

async function resetTestDatabase(): Promise<void> {
  await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await client.unsafe('CREATE SCHEMA public');
}

async function applyBaseline(): Promise<void> {
  const migrations = loadMigrationDescriptors();
  const baseline = migrations[0];
  assert.equal(baseline?.tag, '0000_baseline');
  assert.equal(migrations[1]?.tag, '0001_strava_webhook_inbox_additive');

  const baselineSql = readFileSync(
    resolve(MIGRATIONS_FOLDER, `${baseline.tag}.sql`),
    'utf8',
  );
  for (const statement of baselineSql.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.unsafe(statement);
  }

  await client`CREATE SCHEMA drizzle`;
  await client`
    CREATE TABLE drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  await client`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${baseline.hash}, ${baseline.folderMillis})
  `;
}

async function seedLegacyDuplicates(): Promise<void> {
  await client`
    INSERT INTO strava_webhooks (
      id, subscription_id, verify_token, callback_url, created_at, updated_at
    )
    VALUES
      (
        'existing-callback', 50, 'keep-this-token',
        'https://example.test/existing',
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      ),
      (
        'duplicate-subscription-old', 999, 'old-token',
        'https://example.test/subscription-old',
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      ),
      (
        'duplicate-subscription-new', 999, 'new-token',
        'https://example.test/subscription-new',
        '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'
      )
  `;

  await client`
    INSERT INTO webhook (
      id, resource_state, application_id, callback_url,
      created_at, updated_at, verified, active
    )
    VALUES
      (
        101, 1, 700, 'https://example.test/existing',
        '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', false, true
      ),
      (
        202, 2, 800, 'https://example.test/existing',
        '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z', true, false
      ),
      (
        301, 1, 900, 'https://example.test/new',
        '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z', false, true
      ),
      (
        302, 2, 901, 'https://example.test/new',
        '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z', true, false
      )
  `;
}

async function verifyBackfill(): Promise<void> {
  const existingRows = await client<
    Array<{
      active: boolean;
      application_id: number | null;
      resource_state: number | null;
      subscription_id: string | null;
      verified: boolean;
      verify_token: string;
    }>
  >`
    SELECT
      subscription_id, verify_token, resource_state,
      application_id, verified, active
    FROM strava_webhooks
    WHERE callback_url = 'https://example.test/existing'
  `;
  assert.equal(existingRows.length, 1);
  assert.deepEqual(
    {
      ...existingRows[0],
      subscription_id: Number(existingRows[0]?.subscription_id),
    },
    {
      active: false,
      application_id: 800,
      resource_state: 2,
      subscription_id: 202,
      verified: true,
      verify_token: 'keep-this-token',
    },
  );

  const newRows = await client<
    Array<{ subscription_id: string | null; verify_token: string }>
  >`
    SELECT subscription_id, verify_token
    FROM strava_webhooks
    WHERE callback_url = 'https://example.test/new'
  `;
  assert.equal(newRows.length, 1);
  assert.equal(Number(newRows[0]?.subscription_id), 302);
  assert.equal(newRows[0]?.verify_token, '');

  const duplicateSubscriptionRows = await client<
    Array<{ id: string; subscription_id: string | null }>
  >`
    SELECT id, subscription_id
    FROM strava_webhooks
    WHERE id IN (
      'duplicate-subscription-old',
      'duplicate-subscription-new'
    )
    ORDER BY id
  `;
  assert.deepEqual(
    duplicateSubscriptionRows.map((row) => ({
      ...row,
      subscription_id:
        row.subscription_id === null ? null : Number(row.subscription_id),
    })),
    [
      { id: 'duplicate-subscription-new', subscription_id: 999 },
      { id: 'duplicate-subscription-old', subscription_id: null },
    ],
  );
}

async function main(): Promise<void> {
  await verifyConnectedTarget(client, target);
  await resetTestDatabase();
  try {
    await applyBaseline();
    await seedLegacyDuplicates();
    await runMigrationOperation('apply', environment);
    await verifyBackfill();
    await runMigrationOperation('check', environment);
    console.log('Webhook inbox migration fixture passed.');
  } finally {
    await resetTestDatabase();
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Webhook migration fixture failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
