import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_DATABASE_URL,
  resolveMigrationUrl,
} from './migration-url';

void test('prefers the unpooled URL over the pooled one', () => {
  const resolved = resolveMigrationUrl({
    DATABASE_URL_UNPOOLED: 'postgres://direct/db',
    DATABASE_URL: 'postgres://pooled/db',
    POSTGRES_URL: 'postgres://pooled/db',
  });
  assert.equal(resolved.url, 'postgres://direct/db');
  assert.equal(resolved.source, 'DATABASE_URL_UNPOOLED');
  assert.equal(resolved.pooled, false);
});

void test('falls back to POSTGRES_URL_NON_POOLING', () => {
  const resolved = resolveMigrationUrl({
    POSTGRES_URL_NON_POOLING: 'postgres://direct/db',
    DATABASE_URL: 'postgres://pooled/db',
  });
  assert.equal(resolved.url, 'postgres://direct/db');
  assert.equal(resolved.pooled, false);
});

void test('flags a pooled fallback so callers can warn', () => {
  const resolved = resolveMigrationUrl({ DATABASE_URL: 'postgres://pooled/db' });
  assert.equal(resolved.url, 'postgres://pooled/db');
  assert.equal(resolved.source, 'DATABASE_URL');
  assert.equal(resolved.pooled, true);
});

void test('VERCEL_ENV=development targets the local Docker database', () => {
  const resolved = resolveMigrationUrl({
    VERCEL_ENV: 'development',
    // Deliberately set: local development must never fall through to production.
    DATABASE_URL_UNPOOLED: 'postgres://production/db',
  });
  assert.equal(resolved.url, LOCAL_DATABASE_URL);
  assert.equal(resolved.source, 'local');
});

void test('USE_LOCAL_DB=true targets the local Docker database', () => {
  const resolved = resolveMigrationUrl({
    USE_LOCAL_DB: 'true',
    DATABASE_URL: 'postgres://production/db',
  });
  assert.equal(resolved.url, LOCAL_DATABASE_URL);
});

void test('throws rather than guessing when nothing is configured', () => {
  assert.throws(() => resolveMigrationUrl({}), /No database URL found/);
});
