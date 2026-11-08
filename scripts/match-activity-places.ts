import { parseArgs } from 'node:util';

import { config } from 'dotenv';

const { values } = parseArgs({
  options: { batches: { type: 'string', default: '1' } },
});
const batches = Number(values.batches);
if (!Number.isSafeInteger(batches) || batches < 1 || batches > 100)
  throw new Error('Invalid --batches (1–100)');
config({ path: '.env.development.local', quiet: true });
config({ path: '.env', quiet: true });
const { resolveDatabaseConnection } =
  await import('../src/server/db/connection');
if (
  !['localhost', '127.0.0.1', 'db.localtest.me'].includes(
    new URL(resolveDatabaseConnection(process.env).connectionString).hostname,
  )
)
  throw new Error('Manual matching requires the local development database');
const { processPlaceMatching } =
  await import('../src/server/application/place-matching');
for (let batch = 1; batch <= batches; batch++) {
  const result = await processPlaceMatching();
  console.log(JSON.stringify({ batch, ...result }));
  if (
    !['batch_limit', 'deadline', 'inputs_changed'].includes(result.stopReason)
  )
    break;
}
process.exit(0);
