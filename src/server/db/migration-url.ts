/**
 * Resolves the database URL used for *schema* work — `drizzle-kit generate`,
 * `migrate`, `push` and `studio`, plus the baseline script.
 *
 * This is deliberately separate from the application's runtime connection in
 * `src/server/db/index.ts`, for two reasons:
 *
 * 1. The app talks to Neon over the HTTP driver (`neon-http`), which cannot
 *    hold a multi-statement transaction. Drizzle applies all pending
 *    migrations inside a single transaction, so DDL must go over a direct,
 *    unpooled connection instead — hence the preference order below.
 * 2. The app and the schema tooling previously read *different* environment
 *    variables (`DATABASE_URL` vs `POSTGRES_URL`). When those disagree, the
 *    tooling silently migrates one database while the app reads another.
 *    Everything now resolves through this one function.
 */

/** Docker Postgres behind the local Neon proxy, per LOCAL_DB_SETUP.md. */
export const LOCAL_DATABASE_URL =
  'postgres://postgres:postgres@db.localtest.me:5432/main';

/**
 * Environment variables that point at a direct (non-pooled) connection,
 * in the order we prefer them. Neon and the Vercel integration populate
 * these; see `src/env.js`.
 */
const UNPOOLED_VARS = ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'] as const;

/** Pooled fallbacks, used only if no direct connection is configured. */
const POOLED_VARS = ['DATABASE_URL', 'POSTGRES_URL'] as const;

/**
 * Just the shape we read. Deliberately not `NodeJS.ProcessEnv`, so tests can
 * pass an exact environment rather than having to spread `process.env`.
 */
export type MigrationEnv = Record<string, string | undefined>;

export type ResolvedMigrationUrl = {
  url: string;
  /** Which environment variable it came from, or 'local' for the Docker database. */
  source: string;
  /** True when we had to fall back to a pooled connection. */
  pooled: boolean;
};

export function resolveMigrationUrl(
  env: MigrationEnv = process.env,
): ResolvedMigrationUrl {
  if (env.VERCEL_ENV === 'development' || env.USE_LOCAL_DB === 'true') {
    return { url: LOCAL_DATABASE_URL, source: 'local', pooled: false };
  }

  for (const name of UNPOOLED_VARS) {
    const url = env[name];
    if (url) return { url, source: name, pooled: false };
  }

  for (const name of POOLED_VARS) {
    const url = env[name];
    if (url) return { url, source: name, pooled: true };
  }

  throw new Error(
    'No database URL found for schema tooling. Set DATABASE_URL_UNPOOLED (preferred) ' +
      'or POSTGRES_URL_NON_POOLING, or set VERCEL_ENV=development to target the local ' +
      'Docker database. See docs/database-migrations.md.',
  );
}

/**
 * A warning to surface when we had to fall back to a pooled connection, or
 * `null` when the target is fine. Returned as a string rather than logged
 * here: this module is imported by `drizzle.config.ts`, which runs outside
 * Next and has no access to `~/server/logging`, and server code must not
 * write to the console directly. Note the message names the *variable*, never
 * the URL, which carries credentials.
 */
export function pooledConnectionWarning(
  resolved: ResolvedMigrationUrl,
): string | null {
  if (!resolved.pooled) return null;
  return (
    `[db] Using pooled connection from ${resolved.source}. Migrations run in a single ` +
    "transaction and should use a direct connection: set DATABASE_URL_UNPOOLED to Neon's " +
    'non-pooling URL.'
  );
}
