import { parseArgs } from 'node:util';

import { loadCatalogueArtifact } from '../../src/server/places/catalogue-artifact';
import { publishCatalogue } from '../../src/server/places/catalogue-publish';
import { uploadFile } from '../../src/server/places/convex-catalogue';
import { convexWriteBridge } from '../../src/server/sync/convex-writer';

/**
 * Publish a place catalogue artifact to the Convex backend's live catalogue,
 * where activities are matched against it. Only the difference from the live
 * catalogue is sent, and only activities in the changed tiles are matched
 * again. Without --apply it only reports what publishing would do.
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
    'replace-pending': { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Publish a complete catalogue (default: dry run):\n  pnpm places:publish --artifact <directory> --user <user ID> --athlete <athlete ID> [--apply --expect-current <snapshot-id|none>] [--allow-large-retirement] [--replace-pending <snapshot-id>] [--region <region>]\nOnly the difference from the live catalogue is sent. Running an interrupted --apply again finishes it; --replace-pending abandons the unfinished publication of another artifact instead.\nThe catalogue belongs to no account; the user and athlete only name whose bridge scope signs the requests (use an administrator).\nRequires ACTIVITYMAP_CONVEX_SITE, ACTIVITYMAP_CONVEX_WRITER_KEY_ID and ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY for the backend.',
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
if (values['replace-pending'] && !values.apply)
  throw new Error('--replace-pending only applies with --apply');
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
  ...(values['replace-pending']
    ? { replacePending: values['replace-pending'] }
    : {}),
  ...(values.region ? { regionId: values.region } : {}),
  progress: (sent, total) =>
    console.error(`${sent} of ${total} changed places and tiles sent`),
});
console.log(JSON.stringify({ dryRun: !values.apply, ...report }, null, 2));
process.exit(0);
