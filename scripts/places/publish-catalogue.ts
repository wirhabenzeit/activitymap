import { parseArgs } from 'node:util';

import { loadCatalogueArtifact } from '../../src/server/places/catalogue-artifact';
import { publishCatalogue } from '../../src/server/places/catalogue-publish';
import { uploadFile } from '../../src/server/places/convex-catalogue';
import { convexWriteBridge } from '../../src/server/sync/convex-writer';

/**
 * Publish a place catalogue artifact to the Convex backend, where activities
 * are matched against it, and have every library matched again. Without
 * --apply it only reports what publishing would do.
 */
const { values } = parseArgs({
  options: {
    artifact: { type: 'string' },
    user: { type: 'string' },
    athlete: { type: 'string' },
    region: { type: 'string' },
    apply: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    'expect-current': { type: 'string' },
    'allow-large-retirement': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Publish a complete catalogue (default: dry run):\n  pnpm places:publish --artifact <directory> --user <user ID> --athlete <athlete ID> [--apply --expect-current <snapshot-id|none>] [--allow-large-retirement] [--region <region>]\nThe catalogue belongs to no account; the user and athlete only name whose bridge scope signs the requests (use an administrator).\nRequires ACTIVITYMAP_CONVEX_SITE, ACTIVITYMAP_CONVEX_WRITER_KEY_ID and ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY for the backend.',
  );
  process.exit(0);
}
if (
  !values.artifact ||
  !values.user ||
  !values.athlete ||
  (values.apply && values['dry-run'])
)
  throw new Error(
    'Supply --artifact, --user and --athlete, and choose at most one of --apply or --dry-run',
  );
if (values.apply && !values['expect-current'])
  throw new Error(
    '--apply requires --expect-current from the reviewed dry run (or none for a first publication)',
  );
const athleteId = Number(values.athlete);
if (!Number.isSafeInteger(athleteId) || athleteId <= 0)
  throw new Error('--athlete must be a Strava athlete ID');
const writer = convexWriteBridge({ userId: values.user, athleteId });
if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');

const report = await publishCatalogue({
  catalogue: await loadCatalogueArtifact(values.artifact),
  writer,
  upload: uploadFile,
  apply: !!values.apply,
  expectedCurrent:
    values['expect-current'] === 'none' ? null : values['expect-current'],
  allowLargeRetirement: values['allow-large-retirement'],
  ...(values.region ? { regionId: values.region } : {}),
  progress: (imported, count) =>
    console.error(`${imported} of ${count} places sent`),
});
console.log(JSON.stringify({ dryRun: !values.apply, ...report }, null, 2));
process.exit(0);
