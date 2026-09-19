import assert from 'node:assert/strict';
import test from 'node:test';

import { readMigrationFiles } from 'drizzle-orm/migrator';

import { MIGRATIONS_FOLDER, readMigrations } from './migration-files';

/**
 * The baseline script writes rows that Drizzle's migrator must accept as its
 * own. If drizzle-orm ever changes how it hashes a migration file, this test
 * fails and the baseline script has to be updated to match — otherwise a
 * baselined database would silently replay migrations it has already applied.
 */
void test('hashes and timestamps match drizzle-orm readMigrationFiles', () => {
  const ours = readMigrations(MIGRATIONS_FOLDER);
  const theirs = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

  assert.equal(ours.length, theirs.length);
  assert.ok(ours.length > 0, 'expected at least one migration in the journal');

  for (const [i, mine] of ours.entries()) {
    const reference = theirs[i]!;
    assert.equal(mine.hash, reference.hash, `hash mismatch for ${mine.tag}`);
    assert.equal(
      mine.folderMillis,
      reference.folderMillis,
      `created_at mismatch for ${mine.tag}`,
    );
  }
});

void test('journal order is strictly increasing', () => {
  // Drizzle decides what is pending by comparing against the single newest
  // recorded created_at, so out-of-order entries would make it skip work.
  const migrations = readMigrations(MIGRATIONS_FOLDER);
  for (let i = 1; i < migrations.length; i++) {
    assert.ok(
      migrations[i]!.folderMillis > migrations[i - 1]!.folderMillis,
      `${migrations[i]!.tag} is not newer than ${migrations[i - 1]!.tag}`,
    );
  }
});

void test('every journal entry has a migration file', () => {
  assert.doesNotThrow(() => readMigrations(MIGRATIONS_FOLDER));
});
