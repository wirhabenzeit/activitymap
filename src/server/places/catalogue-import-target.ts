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
