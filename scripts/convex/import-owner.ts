/**
 * Copy one owner's whole library from the LOCAL development Postgres into the
 * Convex application backend. Provisions the owner if needed (operator-only,
 * through the Convex CLI), then runs the shadow-write mirror in full mode
 * through the signed write bridge, so imports and live mirroring share one
 * fenced code path.
 *
 *   pnpm convex:import-owner --user <userId>
 *
 * Re-running is safe: unchanged activities, recordings and matches are
 * no-ops, and only what differs is written.
 */
import {
  WRITER_ENV,
  convexRun,
  loadBridgeEnv,
  parseArgs,
  pinLocalDatabase,
  token,
} from './local-source';

const databaseHost = pinLocalDatabase();
loadBridgeEnv(WRITER_ENV);
const options = parseArgs(process.argv.slice(2));
const userId = options.get('user');
if (!userId) throw new Error('Pass --user <userId>');

const [
  { db },
  { users },
  { eq },
  { mirrorOwner, catalogueFor },
  { postgresMirrorSource, uploadRecording },
  { convexWriteBridge },
] = await Promise.all([
  import('../../src/server/db'),
  import('../../src/server/db/schema'),
  import('drizzle-orm'),
  import('../../src/server/convex-mirror/mirror'),
  import('../../src/server/convex-mirror/postgres-source'),
  import('../../src/server/sync/convex-writer'),
]);

const [user] = await db
  .select({ athleteId: users.athlete_id })
  .from(users)
  .where(eq(users.id, userId));
if (!user?.athleteId) throw new Error('User has no linked athlete');
const actor = {
  userId,
  athleteId: user.athleteId,
  authentication: 'cookie' as const,
};
const source = postgresMirrorSource(actor);
const writer = convexWriteBridge(actor)!;

// Provisioning stays operator-only: it is not exposed on the write bridge.
const prior = await convexRun<{
  athleteId: string;
  backend: 'postgres' | 'convex';
  epoch: string;
  revoked: boolean;
} | null>('importer:owner', { userId });
if (prior?.revoked) throw new Error('The Convex owner is revoked');
if (prior && prior.athleteId !== String(actor.athleteId))
  throw new Error('The Convex owner belongs to a different athlete');
if (prior?.backend !== 'convex') {
  const [first] = await source.activityIds(null, 1);
  if (!first) throw new Error('The owner has no activities');
  const { version } = await source.matches([first]);
  await convexRun('owners:provision', {
    userId,
    athleteId: String(actor.athleteId),
    epoch: token(),
    backend: 'convex',
    ...(prior && { expectedEpoch: prior.epoch }),
    generation: token(),
    catalogue: catalogueFor(version),
    matchingVersion: version,
  });
}

console.error(`Importing ${userId} from ${databaseHost}`);
const result = await mirrorOwner({
  source,
  writer,
  upload: uploadRecording,
  full: true,
  log: (message) => console.error(message),
});
console.log(JSON.stringify({ userId, ...result }));
process.exit(result.complete ? 0 : 1);
