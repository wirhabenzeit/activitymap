import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDatabaseConnection } from './connection.ts';

void test('prefers the Vercel-managed Neon connection', () => {
  const result = resolveDatabaseConnection({
    NEON_DATABASE_URL: 'postgres://managed.example/app',
    DATABASE_URL: 'postgres://legacy.example/app',
  });

  assert.deepEqual(result, {
    connectionString: 'postgres://managed.example/app',
    source: 'NEON_DATABASE_URL',
  });
});

void test('keeps DATABASE_URL as a temporary compatibility fallback', () => {
  const result = resolveDatabaseConnection({
    DATABASE_URL: 'postgres://legacy.example/app',
  });

  assert.deepEqual(result, {
    connectionString: 'postgres://legacy.example/app',
    source: 'DATABASE_URL',
  });
});

void test('ignores empty values and retains the local development default', () => {
  const result = resolveDatabaseConnection({
    NEON_DATABASE_URL: '  ',
    DATABASE_URL: '',
  });

  assert.deepEqual(result, {
    connectionString: 'postgres://postgres:postgres@db.localtest.me:5432/main',
    source: 'local-default',
  });
});

void test('fails closed on Vercel when no database connection is configured', () => {
  assert.throws(
    () => resolveDatabaseConnection({ VERCEL: '1' }),
    /NEON_DATABASE_URL or DATABASE_URL is required/,
  );
});
