import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePreviewMigrationEnvironment } from './preview-migration';

const previewEnvironment = {
  MIGRATION_FORBIDDEN_BRANCH_ID: 'br-production',
  NEON_DATABASE_URL_UNPOOLED:
    'postgresql://user:secret@preview.example.neon.tech/neondb?sslmode=require',
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'feature/automatic-preview-migrations',
};

void test('Preview migration setup is inert outside Vercel Preview', () => {
  assert.equal(
    resolvePreviewMigrationEnvironment({
      ...previewEnvironment,
      VERCEL_ENV: 'production',
    }),
    null,
  );
});

void test('Preview migration setup maps the managed direct Neon URL', () => {
  assert.deepEqual(resolvePreviewMigrationEnvironment(previewEnvironment), {
    MIGRATION_DATABASE_URL: previewEnvironment.NEON_DATABASE_URL_UNPOOLED,
    MIGRATION_EXPECTED_DATABASE: 'neondb',
    MIGRATION_EXPECTED_HOST: 'preview.example.neon.tech',
    MIGRATION_FORBIDDEN_BRANCH_ID: 'br-production',
    MIGRATION_REQUIRE_TARGET_GUARDS: 'true',
  });
});

void test('Preview migration setup requires a production branch deny guard', () => {
  assert.throws(
    () =>
      resolvePreviewMigrationEnvironment({
        ...previewEnvironment,
        MIGRATION_FORBIDDEN_BRANCH_ID: '',
      }),
    /MIGRATION_FORBIDDEN_BRANCH_ID/,
  );
});

void test('Preview migration setup rejects pooled Neon URLs', () => {
  assert.throws(
    () =>
      resolvePreviewMigrationEnvironment({
        ...previewEnvironment,
        NEON_DATABASE_URL_UNPOOLED:
          'postgresql://user:secret@preview-pooler.example.neon.tech/neondb',
      }),
    /direct, unpooled endpoint/,
  );
});

void test('Preview migration setup rejects the Production git branch', () => {
  assert.throws(
    () =>
      resolvePreviewMigrationEnvironment({
        ...previewEnvironment,
        VERCEL_GIT_COMMIT_REF: 'main',
      }),
    /Production branch main/,
  );
});
