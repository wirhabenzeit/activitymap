import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import postgres from 'postgres';

import {
  loadMigrationDescriptors,
  readMigrationState,
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling.ts';
import {
  classifyGeometryRecovery,
  type CurrentGeometryRow,
  type GeometryFingerprint,
} from '../../src/server/db/geometry-freshness-recovery.ts';

config({ path: '.env', override: false, quiet: true });

const APPLY_CONFIRMATION = 'RECOVER_2026_09_20_GEOMETRY';
const BATCH_SIZE = 200;
const RECOVERY_LOCK_NAME = 'activitymap-geometry-freshness-recovery';

type RecoveryMode = 'audit' | 'apply';

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function recoveryMode(environment: NodeJS.ProcessEnv): RecoveryMode {
  const mode = environment.RECOVERY_MODE?.trim() ?? 'audit';
  if (mode !== 'audit' && mode !== 'apply') {
    throw new Error('RECOVERY_MODE must be audit or apply');
  }
  if (
    mode === 'apply' &&
    environment.RECOVERY_CONFIRM?.trim() !== APPLY_CONFIRMATION
  ) {
    throw new Error(
      `Apply mode requires RECOVERY_CONFIRM=${APPLY_CONFIRMATION}`,
    );
  }
  return mode;
}

function sourceEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    CI: environment.CI ?? 'true',
    NODE_ENV: environment.NODE_ENV ?? 'production',
    MIGRATION_DATABASE_URL: required(environment, 'RECOVERY_SOURCE_DATABASE_URL'),
    MIGRATION_EXPECTED_BRANCH_ID:
      environment.RECOVERY_SOURCE_EXPECTED_BRANCH_ID,
    MIGRATION_EXPECTED_DATABASE: required(
      environment,
      'RECOVERY_SOURCE_EXPECTED_DATABASE',
    ),
    MIGRATION_EXPECTED_HOST: required(
      environment,
      'RECOVERY_SOURCE_EXPECTED_HOST',
    ),
    MIGRATION_REQUIRE_TARGET_GUARDS: 'true',
  };
}

function verifyDistinctTargets(
  source: ReturnType<typeof resolveMigrationTarget>,
  target: ReturnType<typeof resolveMigrationTarget>,
): void {
  if (source.identity === target.identity) {
    throw new Error('Source and target databases must be distinct');
  }
  if (!source.isLocal || !target.isLocal) {
    if (
      !target.expectedBranchId ||
      !source.expectedBranchId ||
      target.expectedBranchId === source.expectedBranchId
    ) {
      throw new Error(
        'Distinct expected source and target branch IDs are required',
      );
    }
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readHistoricalDetailedRows(
  client: postgres.Sql,
): Promise<GeometryFingerprint[]> {
  type HistoricalRow = {
    athlete_id: string;
    detailed_polyline: string;
    id: string;
    map_id: string | null;
    summary_polyline: string | null;
  };
  const [schema] = await client<Array<{ has_geometry_state: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'activities'
        AND column_name = 'geometry_state'
    ) AS has_geometry_state
  `;
  const rows = schema?.has_geometry_state
    ? await client<Array<HistoricalRow>>`
        SELECT
          id::text,
          athlete::text AS athlete_id,
          map_id,
          map_summary_polyline AS summary_polyline,
          map_polyline AS detailed_polyline
        FROM activities
        WHERE map_polyline IS NOT NULL
          AND (
            geometry_state = 'detailed'::geometry_state
            OR (geometry_state IS NULL AND is_complete)
          )
        ORDER BY id
      `
    : await client<Array<HistoricalRow>>`
        SELECT
          id::text,
          athlete::text AS athlete_id,
          map_id,
          map_summary_polyline AS summary_polyline,
          map_polyline AS detailed_polyline
        FROM activities
        WHERE map_polyline IS NOT NULL
          AND is_complete
        ORDER BY id
      `;
  return rows.map((row) => ({
    athleteId: row.athlete_id,
    detailedPolyline: row.detailed_polyline,
    id: row.id,
    mapId: row.map_id,
    summaryPolyline: row.summary_polyline,
  }));
}

async function readCurrentRows(
  client: postgres.Sql,
  activityIds: readonly string[],
): Promise<CurrentGeometryRow[]> {
  const result: CurrentGeometryRow[] = [];
  for (const batch of chunks(activityIds, 500)) {
    const rows = await client<
      Array<{
        athlete_id: string;
        detailed_polyline: string | null;
        geometry_state: CurrentGeometryRow['geometryState'];
        id: string;
        map_id: string | null;
        summary_polyline: string | null;
      }>
    >`
      SELECT
        id::text,
        athlete::text AS athlete_id,
        map_id,
        map_summary_polyline AS summary_polyline,
        map_polyline AS detailed_polyline,
        geometry_state::text AS geometry_state
      FROM activities
      WHERE id = ANY(${client.array(batch, 20)})
    `;
    result.push(
      ...rows.map((row) => ({
        athleteId: row.athlete_id,
        detailedPolyline: row.detailed_polyline,
        geometryState: row.geometry_state,
        id: row.id,
        mapId: row.map_id,
        summaryPolyline: row.summary_polyline,
      })),
    );
  }
  return result;
}

function candidateDigest(candidates: readonly GeometryFingerprint[]): string {
  return createHash('sha256')
    .update(candidates.map((candidate) => candidate.id).sort().join('\n'))
    .digest('hex');
}

async function applyBatch(
  client: postgres.Sql,
  candidates: readonly GeometryFingerprint[],
): Promise<number> {
  return client.begin(async (transaction) => {
    const [result] = await transaction.unsafe<
      Array<{ change_count: number; update_count: number }>
    >(
      `
        WITH candidates AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS candidate(
            id bigint,
            athlete_id bigint,
            map_id text,
            summary_polyline text,
            detailed_polyline text
          )
        ), updated AS (
          UPDATE activities AS activity
          SET
            geometry_state = 'detailed'::geometry_state,
            is_complete = true
          FROM candidates AS candidate
          WHERE activity.id = candidate.id
            AND activity.athlete = candidate.athlete_id
            AND activity.geometry_state = 'refresh_required'::geometry_state
            AND activity.map_id IS NOT DISTINCT FROM candidate.map_id
            AND activity.map_summary_polyline IS NOT DISTINCT FROM candidate.summary_polyline
            AND activity.map_polyline IS NOT DISTINCT FROM candidate.detailed_polyline
          RETURNING activity.id, activity.athlete
        ), changes AS (
          INSERT INTO sync_change (
            athlete_id, entity_type, entity_id, operation
          )
          SELECT
            athlete,
            'activity'::sync_entity_type,
            id::text,
            'upsert'::sync_operation
          FROM updated
          RETURNING sequence
        )
        SELECT
          (SELECT count(*)::int FROM updated) AS update_count,
          count(*)::int AS change_count
        FROM changes
      `,
      [
        transaction.json(
          candidates.map((candidate) => ({
            athlete_id: candidate.athleteId,
            detailed_polyline: candidate.detailedPolyline,
            id: candidate.id,
            map_id: candidate.mapId,
            summary_polyline: candidate.summaryPolyline,
          })),
        ),
      ],
    );
    if (!result || result.update_count !== result.change_count) {
      throw new Error('Recovery update and change-feed counts diverged');
    }
    return result.update_count;
  });
}

export async function runGeometryFreshnessRecovery(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const mode = recoveryMode(environment);
  const target = resolveMigrationTarget(environment);
  const source = resolveMigrationTarget(sourceEnvironment(environment));

  if (environment.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true') {
    throw new Error('MIGRATION_REQUIRE_TARGET_GUARDS=true is required');
  }
  verifyDistinctTargets(source, target);

  const sourceClient = postgres(source.connectionString, {
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });
  const targetClient = postgres(target.connectionString, {
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });

  try {
    await verifyConnectedTarget(sourceClient, source);
    await verifyConnectedTarget(targetClient, target);

    const targetMigrationState = await readMigrationState(
      targetClient,
      loadMigrationDescriptors(),
    );
    if (
      targetMigrationState.unbaselined ||
      targetMigrationState.pending.length > 0
    ) {
      throw new Error('Target database migrations are not current');
    }

    const historicalRows = await readHistoricalDetailedRows(sourceClient);
    const currentRows = await readCurrentRows(
      targetClient,
      historicalRows.map((row) => row.id),
    );
    const classification = classifyGeometryRecovery(
      historicalRows,
      currentRows,
    );

    console.log({
      mode,
      sourceHistoricalDetailed: historicalRows.length,
      exactRecoveryCandidates: classification.candidates.length,
      candidateDigest: candidateDigest(classification.candidates),
      alreadyRecovered: classification.alreadyRecovered,
      missingFromTarget: classification.missingFromTarget,
      ownerChanged: classification.ownerChanged,
      routeIdentityChanged: classification.routeIdentityChanged,
      detailedPolylineChanged: classification.detailedPolylineChanged,
    });

    if (mode === 'audit') return;
    if (classification.candidates.length === 0) {
      console.log('No exact recovery candidates remain.');
      return;
    }

    await targetClient`
      SELECT pg_advisory_lock(hashtextextended(${RECOVERY_LOCK_NAME}, 0))
    `;
    try {
      let applied = 0;
      for (const batch of chunks(classification.candidates, BATCH_SIZE)) {
        applied += await applyBatch(targetClient, batch);
      }
      console.log({ applied, requested: classification.candidates.length });
      if (applied !== classification.candidates.length) {
        throw new Error(
          'Some candidates changed after the audit and were safely skipped',
        );
      }
    } finally {
      await targetClient`
        SELECT pg_advisory_unlock(hashtextextended(${RECOVERY_LOCK_NAME}, 0))
      `;
    }
  } finally {
    await Promise.all([
      sourceClient.end({ timeout: 5 }),
      targetClient.end({ timeout: 5 }),
    ]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runGeometryFreshnessRecovery().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Geometry freshness recovery failed: ${message}`);
    process.exitCode = 1;
  });
}
