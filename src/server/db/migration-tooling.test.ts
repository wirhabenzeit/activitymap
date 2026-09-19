import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hashCatalogSnapshot,
  resolveMigrationTarget,
  validateAppliedMigrations,
  validateConnectedTargetIdentity,
  type MigrationDescriptor,
} from './migration-tooling';

const migrations: MigrationDescriptor[] = [
  { folderMillis: 100, hash: 'first', tag: '0000_baseline' },
  { folderMillis: 200, hash: 'second', tag: '0001_additive' },
];

void test('migration tooling uses the direct local database by default', () => {
  const target = resolveMigrationTarget({});
  assert.equal(target.identity, 'localhost:5432/main');
  assert.equal(target.isLocal, true);
});

void test('migration tooling rejects pooled endpoints', () => {
  assert.throws(
    () =>
      resolveMigrationTarget({
        MIGRATION_DATABASE_URL:
          'postgres://user:secret@example-pooler.neon.tech/main',
        MIGRATION_EXPECTED_DATABASE: 'main',
        MIGRATION_EXPECTED_HOST: 'example-pooler.neon.tech',
      }),
    /direct connection/,
  );
});

void test('remote migrations require an independently configured identity', () => {
  assert.throws(
    () =>
      resolveMigrationTarget({
        MIGRATION_DATABASE_URL: 'postgres://user:secret@example.neon.tech/main',
      }),
    /MIGRATION_EXPECTED_HOST/,
  );
});

void test('migration tooling rejects a database-name mismatch', () => {
  assert.throws(
    () =>
      resolveMigrationTarget({
        MIGRATION_DATABASE_URL: 'postgres://user:secret@example.neon.tech/main',
        MIGRATION_EXPECTED_DATABASE: 'other',
        MIGRATION_EXPECTED_HOST: 'example.neon.tech',
      }),
    /database mismatch/,
  );
});

void test('guarded Neon migrations accept a production-branch deny guard', () => {
  const target = resolveMigrationTarget({
    CI: 'true',
    MIGRATION_DATABASE_URL: 'postgres://user:secret@example.neon.tech/main',
    MIGRATION_EXPECTED_DATABASE: 'main',
    MIGRATION_EXPECTED_HOST: 'example.neon.tech',
    MIGRATION_FORBIDDEN_BRANCH_ID: 'br-production',
  });

  assert.equal(target.forbiddenBranchId, 'br-production');
});

void test('connected-target validation rejects the forbidden Neon branch', () => {
  assert.throws(
    () =>
      validateConnectedTargetIdentity(
        { branch_id: 'br-production', database_name: 'main' },
        {
          database: 'main',
          forbiddenBranchId: 'br-production',
        },
      ),
    /branch is forbidden/,
  );
});

void test('connected-target validation accepts a different Neon branch', () => {
  assert.doesNotThrow(() =>
    validateConnectedTargetIdentity(
      { branch_id: 'br-preview', database_name: 'main' },
      {
        database: 'main',
        forbiddenBranchId: 'br-production',
      },
    ),
  );
});

void test('migration history accepts an exact applied prefix', () => {
  const result = validateAppliedMigrations(migrations, [
    { createdAt: 100, hash: 'first' },
  ]);
  assert.deepEqual(result.applied, [migrations[0]]);
  assert.deepEqual(result.pending, [migrations[1]]);
});

void test('migration history rejects changed migration contents', () => {
  assert.throws(
    () =>
      validateAppliedMigrations(migrations, [
        { createdAt: 100, hash: 'tampered' },
      ]),
    /checksum mismatch/,
  );
});

void test('migration history rejects skipped migrations', () => {
  assert.throws(
    () =>
      validateAppliedMigrations(migrations, [
        { createdAt: 200, hash: 'second' },
      ]),
    /not a prefix/,
  );
});

void test('schema fingerprints are deterministic', () => {
  const snapshot = {
    columns: [],
    constraints: [],
    enums: [],
    indexes: [],
    relations: [
      { relation_kind: 'r', relation_name: 'activities' },
      { relation_kind: 'r', relation_name: 'photos' },
    ],
  };
  assert.equal(hashCatalogSnapshot(snapshot), hashCatalogSnapshot(snapshot));
});

void test('schema fingerprints ignore physical column order', () => {
  const snapshot = {
    columns: [
      {
        table_name: 'account',
        ordinal_position: 1,
        column_name: 'id',
        data_type: 'text',
      },
      {
        table_name: 'account',
        ordinal_position: 2,
        column_name: 'userId',
        data_type: 'text',
      },
    ],
    constraints: [],
    enums: [],
    indexes: [],
    relations: [{ relation_kind: 'r', relation_name: 'account' }],
  };
  const physicallyReordered = {
    ...snapshot,
    columns: [
      { ...snapshot.columns[1], ordinal_position: 1 },
      { ...snapshot.columns[0], ordinal_position: 2 },
    ],
  };

  assert.equal(
    hashCatalogSnapshot(snapshot),
    hashCatalogSnapshot(physicallyReordered),
  );
});

void test('schema fingerprints retain semantic column differences', () => {
  const snapshot = {
    columns: [
      {
        table_name: 'account',
        ordinal_position: 1,
        column_name: 'id',
        data_type: 'text',
      },
    ],
    constraints: [],
    enums: [],
    indexes: [],
    relations: [{ relation_kind: 'r', relation_name: 'account' }],
  };
  const changed = {
    ...snapshot,
    columns: [{ ...snapshot.columns[0], data_type: 'bigint' }],
  };

  assert.notEqual(hashCatalogSnapshot(snapshot), hashCatalogSnapshot(changed));
});
