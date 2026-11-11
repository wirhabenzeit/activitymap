import { parseArgs } from 'node:util';

import {
  mirrorCatalogue,
  uploadFile,
} from '../../src/server/places/convex-catalogue';
import { postgresCatalogueSource } from '../../src/server/places/convex-catalogue-source';
import { convexWriteBridge } from '../../src/server/sync/convex-writer';

/**
 * Copy the published place catalogue from the catalogue workspace (the
 * Postgres database `pnpm places:publish` writes to) to the Convex backend,
 * where activities are matched against it. Run it after publishing a
 * catalogue. It is safe to stop and run again: the copy continues where it
 * stopped, and a catalogue that is already copied sends nothing.
 */
const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    athlete: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help || !values.user || !values.athlete) {
  console.log(
    'Copy the published place catalogue to Convex:\n  pnpm places:copy-to-convex --user <user ID> --athlete <athlete ID>\nThe catalogue belongs to no account; the user and athlete only name whose bridge scope signs the requests (use an administrator).\nRequires DATABASE_URL for the catalogue workspace, and ACTIVITYMAP_CONVEX_SITE, ACTIVITYMAP_CONVEX_WRITER_KEY_ID and ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY for the backend.',
  );
  process.exit(values.help ? 0 : 1);
}
const athleteId = Number(values.athlete);
if (!Number.isSafeInteger(athleteId) || athleteId <= 0)
  throw new Error('--athlete must be a Strava athlete ID');
const writer = convexWriteBridge({ userId: values.user, athleteId });
if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');

for (;;) {
  const result = await mirrorCatalogue({
    source: postgresCatalogueSource(),
    writer,
    upload: uploadFile,
    // One run sends for at most a minute, then reports and continues.
    deadline: Date.now() + 60_000,
  });
  console.log(
    `${result.imported} of ${result.count} places copied (${result.sent} sent in this run)`,
  );
  if (result.complete) break;
  if (result.stopped === 'catalogue changed')
    console.log('The catalogue changed during the copy; starting again.');
}
console.log('The catalogue in Convex is current.');
process.exit(0);
