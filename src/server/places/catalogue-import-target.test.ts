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

void test('publication uses separate explicit credentials and permits verified TLS only', async () => {
  const { resolveCataloguePublishTarget } =
    await import('./catalogue-import-target');
  assert.throws(
    () =>
      resolveCataloguePublishTarget({
        DATABASE_URL: local.MIGRATION_DATABASE_URL,
      }),
    /PLACES_DATABASE_URL/,
  );
  const environment = {
    PLACES_DATABASE_URL: local.MIGRATION_DATABASE_URL,
    PLACES_EXPECTED_HOST: '127.0.0.1',
    PLACES_EXPECTED_DATABASE: 'places_test',
  };
  assert.equal(resolveCataloguePublishTarget(environment).isLocal, true);
  const remote = {
    PLACES_DATABASE_URL:
      'postgres://user:password@ep-synthetic.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full',
    PLACES_EXPECTED_HOST: 'ep-synthetic.eu-central-1.aws.neon.tech',
    PLACES_EXPECTED_DATABASE: 'neondb',
    PLACES_EXPECTED_BRANCH_ID: 'br-synthetic',
  };
  const target = resolveCataloguePublishTarget(remote);
  assert.deepEqual(target.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(target.connectionString).search, '');
  for (const mutation of [
    { PLACES_EXPECTED_HOST: 'another.example.com' },
    { PLACES_EXPECTED_DATABASE: 'another' },
    { PLACES_EXPECTED_BRANCH_ID: '' },
    {
      PLACES_DATABASE_URL: remote.PLACES_DATABASE_URL.replace(
        '?sslmode=verify-full',
        '',
      ),
    },
    {
      PLACES_DATABASE_URL: `${remote.PLACES_DATABASE_URL}&host=another.example.com`,
    },
    {
      PLACES_DATABASE_URL: remote.PLACES_DATABASE_URL.replace(
        'verify-full',
        'disable',
      ),
    },
    { PLACES_DATABASE_URL: `${remote.PLACES_DATABASE_URL}#fragment` },
    {
      PLACES_DATABASE_URL: remote.PLACES_DATABASE_URL.replace(
        'ep-synthetic.',
        'ep-synthetic-pooler.',
      ),
    },
  ])
    assert.throws(() =>
      resolveCataloguePublishTarget({ ...remote, ...mutation }),
    );
});
