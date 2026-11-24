// Seeds the Vercel Preview Convex deployment from a filtered production
// snapshot: the libraries of chosen athletes, the shared place catalogue,
// and their sign-in identities without credentials. Production is only
// read. See docs/preview-strava-login.md, "Seeding Preview data".
//
//   pnpm preview:seed [--athletes 123,456] [--dry-run] [--keep]
//
// Athletes default to ACTIVITYMAP_ADMIN_ATHLETE_IDS. The Convex CLI must be
// logged in with access to both deployments.
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';

import { filterSnapshot, schemaTableNames } from './preview-seed/filter.mjs';

const run = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const backend = join(repo, 'backend');

/** Production, as named by .github/workflows/convex-production.yml. */
const PRODUCTION = 'artful-mosquito-425';
const PREVIEW = 'dominik-schroder:activitymap-backend-preview:prod';

const { values } = parseArgs({
  options: {
    athletes: { type: 'string' },
    source: { type: 'string', default: PRODUCTION },
    target: { type: 'string', default: PREVIEW },
    'dry-run': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  },
});

const athleteIds = (
  values.athletes ??
  process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS ??
  ''
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
if (!athleteIds.length || !athleteIds.every((id) => /^\d+$/.test(id)))
  throw new Error(
    'Pass --athletes 123,456 or set ACTIVITYMAP_ADMIN_ATHLETE_IDS (numeric Strava athlete IDs)',
  );
// The import replaces every table, so only a deployment whose name says it
// is for Preview is ever a target.
if (
  values.target.includes(PRODUCTION) ||
  values.target === values.source ||
  !/(^|:)activitymap-backend-preview:/.test(values.target)
)
  throw new Error(
    `The target ${values.target} does not name a preview deployment; refusing to replace its data`,
  );

const schemaTables = schemaTableNames(
  await readFile(join(backend, 'convex/schema.ts'), 'utf8'),
);

const convex = (...args) =>
  run('pnpm', ['exec', 'convex', ...args], {
    cwd: backend,
    maxBuffer: 64 * 1024 * 1024,
  });

const work = await mkdtemp(join(tmpdir(), 'activitymap-preview-seed-'));
await chmod(work, 0o700);
try {
  const snapshot = join(work, 'source.zip');
  const extracted = join(work, 'snapshot');
  const seeded = join(work, 'preview.zip');

  console.log(`Exporting ${values.source} (read-only)…`);
  await convex(
    'export',
    '--deployment',
    values.source,
    '--include-file-storage',
    '--path',
    snapshot,
  );
  await run('unzip', ['-q', snapshot, '-d', extracted], {
    maxBuffer: 64 * 1024 * 1024,
  });
  await rm(snapshot);

  console.log(`Keeping athletes ${athleteIds.join(', ')}…`);
  const { counts, kept } = await filterSnapshot(extracted, {
    athleteIds,
    schemaTables,
  });
  for (const [table, count] of Object.entries(counts).sort())
    console.log(`  ${table.padEnd(20)} ${count}`);
  const missing = athleteIds.length - kept.owners.size;
  if (missing > 0)
    console.warn(
      `  ${missing} athlete(s) have no library in ${values.source}; they will sign in to an empty Preview library`,
    );

  await run('zip', ['-q', '-r', seeded, '.'], {
    cwd: extracted,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (values['dry-run']) {
    console.log(`Dry run: not importing. Seed archive: ${seeded}`);
  } else {
    console.log(`Replacing all data in ${values.target}…`);
    await convex(
      'import',
      '--deployment',
      values.target,
      '--replace-all',
      '--format',
      'zip',
      '--yes',
      seeded,
    );
    console.log(
      'Done. Sign in on a Preview to attach a fresh Strava session to the seeded account.',
    );
  }
} finally {
  if (values.keep || values['dry-run'])
    console.log(
      `Kept working directory ${work} (contains library data; delete it when done)`,
    );
  else await rm(work, { recursive: true, force: true });
}
