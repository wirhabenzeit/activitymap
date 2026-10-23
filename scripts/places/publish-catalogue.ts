import { parseArgs } from 'node:util';

import postgres from 'postgres';

import { verifyConnectedTarget } from '../../src/server/db/migration-tooling';
import { loadCatalogueArtifact } from '../../src/server/places/catalogue-artifact';
import { resolveCataloguePublishTarget } from '../../src/server/places/catalogue-import-target';
import { refreshCatalogue } from '../../src/server/places/catalogue-refresh';

const { values } = parseArgs({
  options: {
    artifact: { type: 'string' },
    region: { type: 'string' },
    apply: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    'expect-current': { type: 'string' },
    'allow-large-retirement': { type: 'boolean' },
    'replace-region': { type: 'string' },
    'expect-replaced': { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Publish or refresh a complete catalogue (default: dry run):\n  pnpm places:publish --artifact <directory> --region switzerland [--apply --expect-current <snapshot-id|none>] [--allow-large-retirement]\nRequires explicit PLACES_DATABASE_URL, PLACES_EXPECTED_HOST and PLACES_EXPECTED_DATABASE; Neon also requires PLACES_EXPECTED_BRANCH_ID. Remote URLs require sslmode=verify-full. Never reads dotenv files or application credentials.',
  );
} else {
  if (!values.artifact || !values.region || (values.apply && values['dry-run']))
    throw new Error(
      'Supply --artifact and --region, and choose at most one of --apply or --dry-run',
    );
  if (values.apply && !values['expect-current'])
    throw new Error(
      '--apply requires --expect-current from the reviewed dry run (or none for a first publication)',
    );
  if (!!values['replace-region'] !== !!values['expect-replaced'])
    throw new Error(
      'Region consolidation requires both --replace-region and --expect-replaced',
    );
  const catalogue = await loadCatalogueArtifact(values.artifact);
  const target = resolveCataloguePublishTarget(process.env);
  const client = postgres(target.connectionString, {
    max: 1,
    prepare: false,
    ssl: target.ssl,
    onnotice: () => undefined,
    connection: {
      search_path: 'public',
      statement_timeout: 120_000,
      lock_timeout: 10_000,
      application_name: 'place-catalogue-publication',
    },
  });
  try {
    await verifyConnectedTarget(client, target);
    const result = await refreshCatalogue(client, catalogue, {
      regionId: values.region,
      dryRun: !values.apply,
      expectedCurrentSnapshot:
        values['expect-current'] === 'none' ? null : values['expect-current'],
      allowLargeRetirement: values['allow-large-retirement'],
      ...(values['replace-region']
        ? {
            replaceRegion: {
              regionId: values['replace-region'],
              expectedSnapshotId: values['expect-replaced']!,
            },
          }
        : {}),
    });
    console.log(
      JSON.stringify(
        { target: target.identity, dryRun: !values.apply, ...result },
        null,
        2,
      ),
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}
