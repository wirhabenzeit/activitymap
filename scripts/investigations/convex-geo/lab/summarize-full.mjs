import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const read = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const report = await read('./results/full-library/summary.json');
const plan = await read('./results/full-library/plan-private.json');
const events = (
  await readFile(
    new URL('./results/full-library-final-cloud-logs.jsonl', import.meta.url),
    'utf8',
  )
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const completions = [
  ...new Map(
    events
      .filter((e) => e.kind === 'Completion')
      .map((e) => [e.executionId, e]),
  ).values(),
];
const actions = completions
  .filter(
    (e) =>
      e.identifier === 'lab:tiledWindows' &&
      e.executionTimestamp * 1000 >= Date.parse(report.startedAt),
  )
  .sort((a, b) => a.executionTimestamp - b.executionTimestamp);
assert.equal(
  actions.length,
  plan.groups.length * 2,
  'Need every completed action',
);
const sum = (items, key) => items.reduce((n, x) => n + (x[key] ?? 0), 0);
const dist = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median:
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
    total: sorted.reduce((a, b) => a + b, 0),
  };
};
const summary = {
  date: '2026-11-07',
  runId: report.runId,
  deployment: report.deployment,
  activities: report.baseline.eligibleActivities,
  totalLocalActivities: report.baseline.totalActivities,
  catalogueCount: report.catalogueCount,
  groups: plan.groups.length,
  activitiesPerGroup: dist(plan.groups.map((g) => g.activities.length)),
  baselineStatuses: report.baseline.statuses,
  postgres: {
    workerWallMs: report.baseline.wallMs,
    workerCpuMs: report.baseline.cpuMs,
    catalogueLoadMs: dist(plan.groups.map((g) => g.pgLoadMs)),
    candidateRows: sum(plan.groups, 'candidates'),
    matchingFieldsJsonBytes: sum(plan.groups, 'jsonBytes'),
    passes: report.baseline.passes.length,
    inputBatches: sum(report.baseline.passes, 'inputBatches'),
    inputReadMs: sum(report.baseline.passes, 'inputReadMs'),
    matchingMs: sum(report.baseline.passes, 'matchingMs'),
  },
  convex: {},
  costAssumptions: {
    plan: 'Starter marginal rates before allowances; not actual invoice',
    usIoPerGiB: 0.22,
    usPerMillionCalls: 2.2,
    usActionPerGiBHour: 0.33,
    otherRegionMultiplier: 1.3,
    excluded: [
      'catalogue import and storage',
      'stream storage and reads',
      'match/check writes',
      'authentication and sync',
      'matcher hosting compute',
    ],
    actionEstimate:
      'conservative elapsed-time × 64MiB estimate; CPU billing may be lower',
  },
};
let offset = 0;
for (const [mode, data] of Object.entries(report.modes)) {
  assert.equal(data.results.length, plan.groups.length);
  assert.equal(data.verified, summary.activities);
  assert(data.results.every((r) => r.parity));
  const selectedActions = actions.slice(offset, offset + plan.groups.length);
  offset += plan.groups.length;
  const ids = new Set(selectedActions.map((a) => a.executionId));
  const queries = completions.filter(
    (e) => e.identifier === 'lab:tilePage' && ids.has(e.parentExecutionId),
  );
  assert.equal(
    queries.length,
    sum(data.results, 'pages'),
    'Incomplete query log capture',
  );
  const readBytes = queries.reduce(
    (n, q) => n + q.usageStats.databaseIoReadBytes,
    0,
  );
  const readDocuments = queries.reduce(
    (n, q) => n + q.usageStats.databaseReadDocuments,
    0,
  );
  const callCount = selectedActions.length + queries.length;
  const actionElapsedGiBHours = selectedActions.reduce(
    (n, a) => n + (a.executionTime * (a.usageStats.memoryUsedMb / 1024)) / 3600,
    0,
  );
  const cost =
    (readBytes / 2 ** 30) * 0.22 +
    (callCount / 1e6) * 2.2 +
    actionElapsedGiBHours * 0.33;
  summary.convex[mode] = {
    verified: data.verified,
    replayWallMs: data.wallMs,
    catalogueRoundTripMs: dist(data.results.map((r) => r.convexRoundTripMs)),
    catalogueServerMs: dist(data.results.map((r) => r.convexServerMs)),
    localInputReadMs: sum(data.results, 'inputReadMs'),
    localMatchingMs: sum(data.results, 'matchingMs'),
    candidateRows: sum(data.results, 'candidates'),
    logicalRowsExamined: sum(data.results, 'scanned'),
    queryCalls: queries.length,
    queryCacheHits: queries.filter((q) => q.cachedResult).length,
    actionCalls: selectedActions.length,
    databaseReadBytes: readBytes,
    databaseReadDocuments: readDocuments,
    maxQueryReadBytes: Math.max(
      ...queries.map((q) => q.usageStats.databaseIoReadBytes),
    ),
    maxQueryReadDocuments: Math.max(
      ...queries.map((q) => q.usageStats.databaseReadDocuments),
    ),
    maxQueryUserMs: Math.max(...queries.map((q) => q.userExecutionTime * 1000)),
    estimatedMarginalUsdUS: cost,
    estimatedMarginalUsdOtherRegion: cost * 1.3,
  };
}
const differences = await read(
  './results/full-library/diagnosis-private.json',
).catch((error) => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
summary.postgresRectangleExtras = differences.map((row) =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== 'missingPoints'),
  ),
);
await writeFile(
  new URL('../full-library-results.json', import.meta.url),
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(JSON.stringify(summary, null, 2));
