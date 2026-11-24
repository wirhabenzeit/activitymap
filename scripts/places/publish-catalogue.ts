import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { loadCatalogueArtifact } from '../../src/server/places/catalogue-artifact';
import { publishCatalogue } from '../../src/server/places/catalogue-publish';
import { convexCatalogueReader } from '../../src/server/places/catalogue-reader';
import { uploadFile } from '../../src/server/places/convex-catalogue';
import { convexWriteBridge } from '../../src/server/sync/convex-writer';

/**
 * Publish a place catalogue artifact to the Convex backend's live catalogue,
 * where activities are matched against it. Only the difference from the live
 * catalogue is sent, and only activities in the changed tiles are matched
 * again. Without --apply it only reports what publishing would do, with the
 * read bridge's key alone.
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
    report: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Publish a complete catalogue (default: dry run):\n  pnpm places:publish --artifact <directory> [--report <file>] [--region <region>]\n  pnpm places:publish --artifact <directory> --apply --expect-current <snapshot-id|none> --user <user ID> --athlete <athlete ID> [--allow-large-retirement] [--replace-pending <snapshot-id>] [--report <file>] [--region <region>]\nOnly the difference from the live catalogue is sent. Running an interrupted --apply again finishes it; --replace-pending abandons the unfinished publication of another artifact instead. --report also writes the report JSON to a file.\nThe catalogue belongs to no account; with --apply the user and athlete only name whose bridge scope signs the writes (use an administrator).\nA dry run requires ACTIVITYMAP_CONVEX_SITE, ACTIVITYMAP_CONVEX_KEY_ID and ACTIVITYMAP_CONVEX_SIGNING_KEY (the read bridge). --apply also requires ACTIVITYMAP_CONVEX_WRITER_KEY_ID and ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY.',
  );
  process.exit(0);
}
if (!values.artifact || (values.apply && values['dry-run']))
  throw new Error(
    'Supply --artifact, and choose at most one of --apply or --dry-run',
  );
if (values.apply && (!values.user || !values.athlete))
  throw new Error('--apply requires --user and --athlete');
if (values.apply && !values['expect-current'])
  throw new Error(
    '--apply requires --expect-current from the reviewed dry run (or none for a first publication)',
  );
if (values['replace-pending'] && !values.apply)
  throw new Error('--replace-pending only applies with --apply');
const reader = convexCatalogueReader();
if (!reader) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
let writer;
if (values.apply) {
  const athleteId = Number(values.athlete);
  if (!Number.isSafeInteger(athleteId) || athleteId <= 0)
    throw new Error('--athlete must be a Strava athlete ID');
  writer = convexWriteBridge({ userId: values.user!, athleteId })!;
}

const report = await publishCatalogue({
  catalogue: await loadCatalogueArtifact(values.artifact),
  reader,
  ...(writer ? { writer, upload: uploadFile } : {}),
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
const json = JSON.stringify({ dryRun: !values.apply, ...report }, null, 2);
if (values.report) await writeFile(values.report, `${json}\n`);
console.log(json);
process.exit(0);
