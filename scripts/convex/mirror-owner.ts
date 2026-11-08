/**
 * Shadow-write one owner's recent Postgres changes into the Convex
 * application backend, from the LOCAL development database.
 *
 *   pnpm convex:mirror-owner --user <userId> [--watch <seconds>]
 *
 * Without --watch it runs once. The owner must already be imported
 * (`pnpm convex:import-owner`).
 */
import {
  WRITER_ENV,
  loadBridgeEnv,
  parseArgs,
  pinLocalDatabase,
} from './local-source';

pinLocalDatabase();
loadBridgeEnv(WRITER_ENV);
const options = parseArgs(process.argv.slice(2));
const userId = options.get('user');
if (!userId) throw new Error('Pass --user <userId>');
const watch = Number(options.get('watch') ?? 0);

const [
  { db },
  { users },
  { eq },
  { mirrorOwner },
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

for (;;) {
  const result = await mirrorOwner({
    source,
    writer,
    upload: uploadRecording,
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  if (!watch) break;
  await new Promise((resolve) => setTimeout(resolve, watch * 1000));
}
process.exit(0);
