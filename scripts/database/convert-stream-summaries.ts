import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import { convertStreamSummaryBatch } from '../../src/server/repositories/stream-summary-storage';

config({ path: '.env', override: false, quiet: true });
const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const format = value('--format');
if (format !== 'json' && format !== 'polyline-v1')
  throw new Error('Specify --format polyline-v1 or --format json');
const target = resolveMigrationTarget({
  ...process.env,
  MIGRATION_REQUIRE_TARGET_GUARDS: 'true',
});
const apply = args.includes('--apply');
if (apply && value('--confirm') !== target.identity)
  throw new Error(`Writes require --apply --confirm ${target.identity}`);
const client = postgres(target.connectionString, { max: 1, prepare: false });
try {
  await verifyConnectedTarget(client, target);
  const result = await convertStreamSummaryBatch(
    drizzle(client) as unknown as Parameters<
      typeof convertStreamSummaryBatch
    >[0],
    {
      format,
      apply,
      limit: value('--limit') === undefined ? 100 : Number(value('--limit')),
    },
  );
  console.log(
    JSON.stringify({
      target: target.identity,
      format,
      dryRun: !apply,
      ...result,
    }),
  );
} finally {
  await client.end();
}
