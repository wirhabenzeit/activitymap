import { parseArgs } from 'node:util';

import postgres from 'postgres';

import { verifyConnectedTarget } from '../../src/server/db/migration-tooling';
import { loadCatalogueArtifact } from '../../src/server/places/catalogue-artifact';
import { importCatalogue } from '../../src/server/places/catalogue-import';
import { resolveCatalogueImportTarget } from '../../src/server/places/catalogue-import-target';

const { values } = parseArgs({
  options: {
    artifact: { type: 'string' },
    apply: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Import a validated frozen catalogue into an explicitly guarded local database:\n  pnpm places:import --artifact <directory> [--dry-run | --apply]\nDefaults to dry-run. Requires MIGRATION_DATABASE_URL, MIGRATION_EXPECTED_HOST and MIGRATION_EXPECTED_DATABASE. Never reads .env or accepts a remote target.',
  );
} else {
  if (!values.artifact || (values.apply && values['dry-run'])) {
    throw new Error(
      'Required: --artifact <directory>; choose at most one of --apply and --dry-run',
    );
  }
  // No implicit fallback, dotenv loading, production URL or pooled connection.
  const target = resolveCatalogueImportTarget(process.env);
  const catalogue = await loadCatalogueArtifact(values.artifact);
  const client = postgres(target.connectionString, {
    max: 1,
    prepare: false,
    connection: {
      search_path: 'public',
      statement_timeout: 60_000,
      lock_timeout: 10_000,
    },
    onnotice: () => undefined,
  });
  try {
    await verifyConnectedTarget(client, target);
    const result = await importCatalogue(client, catalogue, {
      dryRun: !values.apply,
    });
    console.log(
      JSON.stringify(
        {
          target: target.identity,
          dry_run: !values.apply,
          snapshot_id: catalogue.manifest.catalogue_snapshot_id,
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}
