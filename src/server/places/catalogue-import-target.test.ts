import assert from 'node:assert/strict';

import test from 'node:test';

import { resolveCatalogueImportTarget } from './catalogue-import-target';

const local = {
  MIGRATION_DATABASE_URL:
    'postgres://postgres:postgres@127.0.0.1:55432/places_test',
  MIGRATION_EXPECTED_HOST: '127.0.0.1',
  MIGRATION_EXPECTED_DATABASE: 'places_test',
};

void test('accepts only explicit matching local targets and never falls back to app credentials', () => {
  assert.equal(
    resolveCatalogueImportTarget(local).identity,
    '127.0.0.1:55432/places_test',
  );
  assert.throws(
    () =>
      resolveCatalogueImportTarget({
        DATABASE_URL: local.MIGRATION_DATABASE_URL,
      }),
    /MIGRATION_DATABASE_URL/,
  );
  assert.throws(
    () =>
      resolveCatalogueImportTarget({
        MIGRATION_DATABASE_URL: local.MIGRATION_DATABASE_URL,
      }),
    /EXPECTED_HOST/,
  );
  assert.throws(
    () =>
      resolveCatalogueImportTarget({
        ...local,
        MIGRATION_EXPECTED_DATABASE: 'another',
      }),
    /mismatch/,
  );
});

void test('remote targets and driver-option overrides fail before connection creation', () => {
  assert.throws(
    () =>
      resolveCatalogueImportTarget({
        ...local,
        MIGRATION_DATABASE_URL:
          'postgres://user:password@db.example.com/places_test',
        MIGRATION_EXPECTED_HOST: 'db.example.com',
      }),
    /only accepts a local/,
  );
  for (const suffix of [
    '?search_path=other_schema',
    '?host=db.example.com',
    '?options=-csearch_path%3Dother',
    '?sslmode=require',
    '#ignored',
  ]) {
    assert.throws(
      () =>
        resolveCatalogueImportTarget({
          ...local,
          MIGRATION_DATABASE_URL: local.MIGRATION_DATABASE_URL + suffix,
        }),
      /plain PostgreSQL URL/,
    );
  }
});
