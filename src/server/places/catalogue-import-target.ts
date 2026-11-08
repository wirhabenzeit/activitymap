import { resolveMigrationTarget } from '../db/migration-tooling';

/** The manual POC accepts an explicit, guarded, direct local URL only. */
export function resolveCatalogueImportTarget(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const target = resolveMigrationTarget({
    ...environment,
    MIGRATION_REQUIRE_TARGET_GUARDS: 'true',
  });
  if (!target.isLocal) {
    throw new Error('The catalogue POC importer only accepts a local database');
  }
  // postgres.js merges URL query parameters into connection/startup options;
  // they can override host or search_path despite explicit constructor options.
  const url = new URL(target.connectionString);
  if (url.search || url.hash) {
    throw new Error(
      'Catalogue imports require a plain PostgreSQL URL without query parameters or a fragment',
    );
  }
  return target;
}

/** Separate publication credentials; application DATABASE_URL is never read. */
export function resolveCataloguePublishTarget(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (!environment.PLACES_DATABASE_URL)
    throw new Error(
      'PLACES_DATABASE_URL is required for catalogue publication',
    );
  const url = new URL(environment.PLACES_DATABASE_URL);
  // Permit TLS configuration only. Other postgres.js query parameters can
  // redirect the connection or change its search_path after target validation.
  for (const key of url.searchParams.keys())
    if (key !== 'sslmode')
      throw new Error('Only sslmode is allowed in publication URLs');
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode && !['require', 'verify-full'].includes(sslmode))
    throw new Error('Publication TLS must verify the server certificate');
  if (url.hash) throw new Error('Publication URLs cannot contain a fragment');
  url.search = '';
  const target = resolveMigrationTarget({
    MIGRATION_DATABASE_URL: url.toString(),
    MIGRATION_EXPECTED_HOST: environment.PLACES_EXPECTED_HOST,
    MIGRATION_EXPECTED_DATABASE: environment.PLACES_EXPECTED_DATABASE,
    MIGRATION_EXPECTED_BRANCH_ID: environment.PLACES_EXPECTED_BRANCH_ID,
    MIGRATION_REQUIRE_TARGET_GUARDS: 'true',
  });
  if (!target.isLocal && !sslmode)
    throw new Error('Remote publication requires sslmode=verify-full');
  return {
    ...target,
    ssl: sslmode ? { rejectUnauthorized: true } : (false as const),
  };
}
