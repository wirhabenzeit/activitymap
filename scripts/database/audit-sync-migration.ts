import { config } from 'dotenv';
import { appendFile } from 'node:fs/promises';
import postgres from 'postgres';

import {
  formatSyncMigrationAudit,
  type SyncMigrationAudit,
} from '../../src/server/db/sync-migration-audit.ts';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling.ts';

config({ path: '.env', override: false, quiet: true });

interface ActivityAuditRow {
  geometry_state_missing: number;
  last_summary_seen_missing: number;
  legacy_detailed_fallbacks: number;
  legacy_summary_fallbacks: number;
  total: number;
}

interface AthleteAuditRow {
  connected: number;
  never_reconciled: number;
  stale_over_seven_days: number;
}

export async function auditSyncMigration(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<SyncMigrationAudit> {
  const target = resolveMigrationTarget(environment);
  const client = postgres(target.connectionString, {
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });

  console.log(`Audit target: ${target.identity}`);
  try {
    await verifyConnectedTarget(client, target);

    const [activities] = await client<ActivityAuditRow[]>`
      SELECT
        count(*)::integer AS total,
        count(*) FILTER (WHERE geometry_state IS NULL)::integer
          AS geometry_state_missing,
        count(*) FILTER (
          WHERE geometry_state IS NULL AND is_complete
        )::integer AS legacy_detailed_fallbacks,
        count(*) FILTER (
          WHERE geometry_state IS NULL AND NOT is_complete
        )::integer AS legacy_summary_fallbacks,
        count(*) FILTER (WHERE last_summary_seen_at IS NULL)::integer
          AS last_summary_seen_missing
      FROM activities
    `;
    const [athletes] = await client<AthleteAuditRow[]>`
      WITH connected_athletes AS (
        SELECT DISTINCT
          users.id,
          users.last_summary_reconciled_at
        FROM "user" AS users
        INNER JOIN account AS accounts ON accounts."userId" = users.id
        WHERE
          users.athlete_id IS NOT NULL
          AND accounts."providerId" = 'strava'
          AND accounts.revoked_at IS NULL
          AND COALESCE(accounts."accessToken", accounts.access_token) IS NOT NULL
      )
      SELECT
        count(*)::integer AS connected,
        count(*) FILTER (
          WHERE last_summary_reconciled_at IS NULL
        )::integer AS never_reconciled,
        count(*) FILTER (
          WHERE last_summary_reconciled_at < now() - interval '7 days'
        )::integer AS stale_over_seven_days
      FROM connected_athletes
    `;
    const [reconciliations] = await client<Array<{ in_progress: number }>>`
      SELECT count(*)::integer AS in_progress
      FROM strava_summary_reconciliation
    `;

    if (!activities || !athletes || !reconciliations) {
      throw new Error('The sync migration audit returned no aggregate row');
    }

    return {
      activities: {
        geometryStateMissing: activities.geometry_state_missing,
        lastSummarySeenMissing: activities.last_summary_seen_missing,
        legacyDetailedFallbacks: activities.legacy_detailed_fallbacks,
        legacySummaryFallbacks: activities.legacy_summary_fallbacks,
        total: activities.total,
      },
      athletes: {
        connected: athletes.connected,
        neverReconciled: athletes.never_reconciled,
        staleOverSevenDays: athletes.stale_over_seven_days,
      },
      reconciliationsInProgress: reconciliations.in_progress,
    };
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function run(): Promise<void> {
  const report = formatSyncMigrationAudit(await auditSyncMigration());
  console.log(report);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (summaryPath) await appendFile(summaryPath, `${report}\n`, 'utf8');
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Sync migration audit failed: ${message}`);
  process.exitCode = 1;
});
