import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { config } from 'dotenv';

import { resolveDatabaseConnection } from '../src/server/db/connection';

const { values } = parseArgs({
  options: {
    'min-activities': { type: 'string', default: '1000' },
    out: {
      type: 'string',
      default: 'output/quality/admin-timeout/dashboard.json',
    },
  },
});
const minimum = Number(values['min-activities']);
if (!Number.isSafeInteger(minimum) || minimum < 1)
  throw new Error('Invalid --min-activities');
config({ path: '.env.development.local', quiet: true });
config({ path: '.env', quiet: true });
const connection = resolveDatabaseConnection(process.env);
if (
  !['localhost', '127.0.0.1', 'db.localtest.me'].includes(
    new URL(connection.connectionString).hostname,
  )
)
  throw new Error('Dashboard benchmarks require a local database snapshot');

const { loadAdminDashboard } =
  await import('../src/server/application/admin-dashboard');
const started = performance.now();
const dashboard = await loadAdminDashboard();
const durationMs = performance.now() - started;
const activities = dashboard.coverage.reduce(
  (sum, row) => sum + row.status.history.knownActivityCount,
  0,
);
assert(
  activities >= minimum,
  `Need at least ${minimum} stored activities for a representative benchmark; found ${activities}`,
);
const report = {
  measuredAt: new Date().toISOString(),
  activities,
  accounts: dashboard.coverage.length,
  durationMs,
  peakProcessRssMiB: process.resourceUsage().maxRSS / 1024,
  scope:
    'Complete admin data-loading path on a local snapshot. Read-only; no Strava calls, writes or authentication bypass. No user identifiers or activity data in this report.',
};
await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
process.exit(0);
