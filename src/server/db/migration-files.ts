import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Reading the migration journal the same way Drizzle's migrator does.
 *
 * Drizzle records an applied migration in `drizzle.__drizzle_migrations` as a
 * SHA-256 of the migration file's raw contents plus `created_at`, which is the
 * `when` field from `drizzle/meta/_journal.json`. The baseline script has to
 * produce byte-identical rows, so this mirrors `readMigrationFiles` from
 * `drizzle-orm/migrator` — `migration-files.test.ts` asserts the two agree.
 */

export const MIGRATIONS_FOLDER = 'drizzle';
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

export type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

export type Migration = {
  tag: string;
  /** The value Drizzle stores as `created_at`. */
  folderMillis: number;
  hash: string;
};

export function readMigrations(folder = MIGRATIONS_FOLDER): Migration[] {
  const journalPath = path.join(folder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`No migration journal found at ${journalPath}`);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: JournalEntry[];
  };

  return journal.entries.map((entry) => {
    const sqlPath = path.join(folder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Journal references ${entry.tag} but ${sqlPath} is missing`);
    }
    const contents = fs.readFileSync(sqlPath, 'utf8');
    return {
      tag: entry.tag,
      folderMillis: entry.when,
      hash: crypto.createHash('sha256').update(contents).digest('hex'),
    };
  });
}
