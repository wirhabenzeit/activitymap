import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type postgres from 'postgres';

export const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');
export const MIGRATION_LOCK_NAME = 'activitymap-schema-migrations';

const LOCAL_MIGRATION_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5432/main';

type Environment = Readonly<Record<string, string | undefined>>;
type DatabaseClient = postgres.Sql;

export interface MigrationTarget {
  connectionString: string;
  database: string;
  expectedBranchId?: string;
  forbiddenBranchId?: string;
  hostname: string;
  identity: string;
  isLocal: boolean;
}

export interface MigrationDescriptor {
  folderMillis: number;
  hash: string;
  tag: string;
}

export interface AppliedMigration {
  createdAt: number;
  hash: string;
}

export interface MigrationState {
  applied: MigrationDescriptor[];
  pending: MigrationDescriptor[];
  unbaselined: boolean;
}

export interface BaselineManifest {
  folderMillis: number;
  migrationSha256: string;
  schemaSha256: string;
  tag: string;
  version: number;
}

interface Journal {
  entries: Array<{ tag: string }>;
}

interface CatalogSnapshot {
  columns: Record<string, unknown>[];
  constraints: Record<string, unknown>[];
  enums: Record<string, unknown>[];
  indexes: Record<string, unknown>[];
  relations: Record<string, unknown>[];
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function isLocalHostname(hostname: string): boolean {
  return ['127.0.0.1', '::1', 'db.localtest.me', 'localhost'].includes(
    hostname.toLowerCase(),
  );
}

function databaseFromUrl(url: URL): string {
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('Migration URL must include a database name');
  return database;
}

export function resolveMigrationTarget(
  environment: Environment,
): MigrationTarget {
  const configuredUrl = nonEmpty(environment.MIGRATION_DATABASE_URL);
  const requiresGuards =
    environment.MIGRATION_REQUIRE_TARGET_GUARDS === 'true' ||
    environment.NODE_ENV === 'production' ||
    Boolean(nonEmpty(environment.CI));

  if (!configuredUrl && requiresGuards) {
    throw new Error(
      'MIGRATION_DATABASE_URL is required outside local development',
    );
  }

  const connectionString = configuredUrl ?? LOCAL_MIGRATION_DATABASE_URL;
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('MIGRATION_DATABASE_URL must be a PostgreSQL URL');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname.includes('pooler')) {
    throw new Error(
      'MIGRATION_DATABASE_URL must use a direct connection, not a pooled endpoint',
    );
  }

  const database = databaseFromUrl(parsed);
  const isLocal = isLocalHostname(hostname);
  const expectedHost = nonEmpty(environment.MIGRATION_EXPECTED_HOST);
  const expectedDatabase = nonEmpty(environment.MIGRATION_EXPECTED_DATABASE);
  const expectedBranchId = nonEmpty(environment.MIGRATION_EXPECTED_BRANCH_ID);
  const forbiddenBranchId = nonEmpty(environment.MIGRATION_FORBIDDEN_BRANCH_ID);

  if (expectedHost && hostname !== expectedHost.toLowerCase()) {
    throw new Error(
      `Migration target host mismatch: expected ${expectedHost}, received ${hostname}`,
    );
  }
  if (expectedDatabase && database !== expectedDatabase) {
    throw new Error(
      `Migration target database mismatch: expected ${expectedDatabase}, received ${database}`,
    );
  }

  if (!isLocal && (!expectedHost || !expectedDatabase)) {
    throw new Error(
      'Remote migrations require MIGRATION_EXPECTED_HOST and MIGRATION_EXPECTED_DATABASE',
    );
  }
  if (requiresGuards && (!expectedHost || !expectedDatabase)) {
    throw new Error(
      'Guarded migrations require MIGRATION_EXPECTED_HOST and MIGRATION_EXPECTED_DATABASE',
    );
  }
  if (
    requiresGuards &&
    hostname.endsWith('.neon.tech') &&
    !expectedBranchId &&
    !forbiddenBranchId
  ) {
    throw new Error(
      'Guarded Neon migrations require MIGRATION_EXPECTED_BRANCH_ID or MIGRATION_FORBIDDEN_BRANCH_ID',
    );
  }

  const port = parsed.port ? `:${parsed.port}` : '';
  return {
    connectionString,
    database,
    expectedBranchId,
    forbiddenBranchId,
    hostname,
    identity: `${hostname}${port}/${database}`,
    isLocal,
  };
}

export function loadMigrationDescriptors(): MigrationDescriptor[] {
  const journal = JSON.parse(
    readFileSync(resolve(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  const migrations = readMigrationFiles({
    migrationsFolder: MIGRATIONS_FOLDER,
  });

  if (journal.entries.length !== migrations.length) {
    throw new Error('Migration journal and SQL files are inconsistent');
  }

  return migrations.map((migration, index) => {
    const entry = journal.entries[index];
    if (!entry) throw new Error(`Migration journal entry ${index} is missing`);
    return {
      folderMillis: migration.folderMillis,
      hash: migration.hash,
      tag: entry.tag,
    };
  });
}

export function loadBaselineManifest(): BaselineManifest {
  return JSON.parse(
    readFileSync(resolve(MIGRATIONS_FOLDER, 'baseline-manifest.json'), 'utf8'),
  ) as BaselineManifest;
}

export function validateBaselineManifest(
  migrations: MigrationDescriptor[],
  manifest: BaselineManifest,
): MigrationDescriptor {
  const baseline = migrations[0];
  if (!baseline) throw new Error('At least one migration is required');
  if (
    manifest.version !== 1 ||
    baseline.tag !== manifest.tag ||
    baseline.folderMillis !== manifest.folderMillis ||
    baseline.hash !== manifest.migrationSha256
  ) {
    throw new Error(
      'Baseline manifest does not match the first migration; regenerate or repair it before continuing',
    );
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.schemaSha256)) {
    throw new Error('Baseline manifest has an invalid schema fingerprint');
  }
  return baseline;
}

export function validateAppliedMigrations(
  migrations: MigrationDescriptor[],
  appliedRows: AppliedMigration[],
): Pick<MigrationState, 'applied' | 'pending'> {
  if (appliedRows.length > migrations.length) {
    throw new Error('Database contains more migrations than this checkout');
  }

  const applied = appliedRows.map((row, index) => {
    const expected = migrations[index];
    if (!expected) throw new Error('Database migration history is unknown');
    if (row.createdAt !== expected.folderMillis) {
      throw new Error(
        `Migration history is not a prefix at position ${index}: expected ${expected.tag}`,
      );
    }
    if (row.hash !== expected.hash) {
      throw new Error(`Migration checksum mismatch for ${expected.tag}`);
    }
    return expected;
  });

  return { applied, pending: migrations.slice(applied.length) };
}

export async function verifyConnectedTarget(
  client: DatabaseClient,
  target: MigrationTarget,
): Promise<void> {
  const rows = await client<
    Array<{ branch_id: string | null; database_name: string }>
  >`
    SELECT
      current_database() AS database_name,
      current_setting('neon.branch_id', true) AS branch_id
  `;
  const actual = rows[0];
  if (!actual) throw new Error('Could not identify the connected database');
  validateConnectedTargetIdentity(actual, target);
}

export function validateConnectedTargetIdentity(
  actual: { branch_id: string | null; database_name: string },
  target: Pick<
    MigrationTarget,
    'database' | 'expectedBranchId' | 'forbiddenBranchId'
  >,
): void {
  if (actual.database_name !== target.database) {
    throw new Error(
      `Connected database mismatch: expected ${target.database}, received ${actual.database_name}`,
    );
  }
  if (target.expectedBranchId && actual.branch_id !== target.expectedBranchId) {
    throw new Error(
      `Connected Neon branch mismatch: expected ${target.expectedBranchId}, received ${actual.branch_id ?? 'unknown'}`,
    );
  }
  if (
    target.forbiddenBranchId &&
    actual.branch_id === target.forbiddenBranchId
  ) {
    throw new Error(
      `Connected Neon branch is forbidden: ${target.forbiddenBranchId}`,
    );
  }
}

export async function readMigrationState(
  client: DatabaseClient,
  migrations: MigrationDescriptor[],
): Promise<MigrationState> {
  const tableRows = await client<Array<{ migration_table: string | null }>>`
    SELECT to_regclass('drizzle.__drizzle_migrations')::text AS migration_table
  `;
  const hasMigrationTable = Boolean(tableRows[0]?.migration_table);

  const publicTableRows = await client<Array<{ table_name: string }>>`
    SELECT tablename AS table_name
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;

  if (!hasMigrationTable) {
    return {
      applied: [],
      pending: migrations,
      unbaselined: publicTableRows.length > 0,
    };
  }

  const appliedRows = await client<Array<{ created_at: string; hash: string }>>`
    SELECT created_at::text, hash
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC
  `;
  const history = validateAppliedMigrations(
    migrations,
    appliedRows.map((row) => ({
      createdAt: Number(row.created_at),
      hash: row.hash,
    })),
  );

  return { ...history, unbaselined: false };
}

function normalizeCatalogRows(
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value,
        ]),
      ),
    )
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

export function hashCatalogSnapshot(snapshot: CatalogSnapshot): string {
  // PostgreSQL preserves the physical order in which columns were added, but
  // that order does not affect queries, constraints, or application behavior.
  // Existing databases can therefore be semantically identical to a freshly
  // materialized baseline while reporting different ordinal positions.
  const semanticSnapshot = {
    columns: normalizeCatalogRows(
      snapshot.columns.map(
        ({ ordinal_position: _ordinalPosition, ...column }) => column,
      ),
    ),
    constraints: normalizeCatalogRows(snapshot.constraints),
    enums: normalizeCatalogRows(snapshot.enums),
    indexes: normalizeCatalogRows(snapshot.indexes),
    relations: normalizeCatalogRows(snapshot.relations),
  };
  return createHash('sha256')
    .update(JSON.stringify(semanticSnapshot))
    .digest('hex');
}

export async function fingerprintPublicSchema(
  client: DatabaseClient,
): Promise<{ hash: string; snapshot: CatalogSnapshot }> {
  const relations = await client<Record<string, unknown>[]>`
    SELECT c.relname AS relation_name, c.relkind AS relation_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
    ORDER BY c.relname
  `;
  const columns = await client<Record<string, unknown>[]>`
    SELECT
      c.relname AS table_name,
      a.attnum AS ordinal_position,
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attnotnull AS not_null,
      pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
      a.attidentity AS identity_kind,
      a.attgenerated AS generated_kind
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum
  `;
  const constraints = await client<Record<string, unknown>[]>`
    SELECT
      c.relname AS table_name,
      con.conname AS constraint_name,
      con.contype AS constraint_type,
      pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY c.relname, con.conname
  `;
  const indexes = await client<Record<string, unknown>[]>`
    SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `;
  const enums = await client<Record<string, unknown>[]>`
    SELECT
      t.typname AS enum_name,
      e.enumsortorder::text AS sort_order,
      e.enumlabel AS enum_label
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `;

  const snapshot = {
    columns: normalizeCatalogRows(columns),
    constraints: normalizeCatalogRows(constraints),
    enums: normalizeCatalogRows(enums),
    indexes: normalizeCatalogRows(indexes),
    relations: normalizeCatalogRows(relations),
  };
  return { hash: hashCatalogSnapshot(snapshot), snapshot };
}
