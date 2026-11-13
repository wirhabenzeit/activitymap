import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const dir = new URL('./results/', import.meta.url);
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, dir), 'utf8'));
const readOptional = (path) =>
  read(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
const manifest = await read('hosted-matching-private/manifest.json');
const baseline = await read('full-library/postgis.json');
const synthetic = await readOptional('hosted-matching-synthetic.json');
const fixtureIngestion = await readOptional('hosted-matching-ingestion.json');
const erasure = await readOptional('hosted-matching-erasure.json');
const partial = process.argv.includes('--partial');
const outcomes = {};
for (const mode of [
  'single',
  'actual',
  'frozen',
  'parallel',
  'bounded',
  'isolated',
]) {
  const summary = await readOptional(`hosted-matching-${mode}.json`);
  const checkpoint = await readOptional(
    `hosted-matching-private/replay-${mode}.json`,
  );
  if (!summary || !checkpoint) {
    assert(partial, `Missing ${mode} outcome`);
    outcomes[mode] = {
      state: 'incomplete',
      groups: checkpoint?.groups.length ?? 0,
      verified:
        checkpoint?.groups.reduce((sum, g) => sum + g.indices.length, 0) ?? 0,
    };
    continue;
  }
  const samples = checkpoint.groups
    .map((g) => g.observedMs)
    .sort((a, b) => a - b);
  const percentile = (p) =>
    samples[Math.max(0, Math.ceil(samples.length * p) - 1)];
  outcomes[mode] = {
    state: 'verified',
    ...summary,
    totals: Object.fromEntries(
      Object.entries(summary.totals).filter(
        ([name]) => !name.startsWith('rss'),
      ),
    ),
    groupObservedMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: samples.at(-1),
    },
    groupsAbove512MiBProcessHighWater: checkpoint.groups.filter(
      (g) => g.metrics.rssMiB > 512,
    ).length,
    rssInstrumentedGroups: checkpoint.groups.filter(
      (g) => g.metrics.rssObservedMiB !== undefined,
    ).length,
    maxObservedRssMiB: checkpoint.groups.some(
      (g) => g.metrics.rssObservedMiB !== undefined,
    )
      ? Math.max(...checkpoint.groups.map((g) => g.metrics.rssObservedMiB ?? 0))
      : null,
    groupsThatRaisedProcessPeakAbove512MiB: checkpoint.groups.filter(
      (g) =>
        g.metrics.rssHighWaterAtStartMiB !== undefined &&
        g.metrics.rssMiB > 512 &&
        g.metrics.rssMiB > g.metrics.rssHighWaterAtStartMiB,
    ).length,
    maxGroupActivities: Math.max(
      ...checkpoint.groups.map((g) => g.indices.length),
    ),
  };
}
if (
  outcomes.actual.state === 'verified' &&
  outcomes.frozen.state === 'verified'
) {
  const a = (
    await read('hosted-matching-private/replay-actual.json')
  ).groups.filter((g) => g.indices.length);
  const b = (await read('hosted-matching-private/replay-frozen.json')).groups;
  outcomes.actual.sameOrdinalMembershipAsFrozen = a.filter(
    (group, i) =>
      JSON.stringify(group.indices) === JSON.stringify(b[i]?.indices),
  ).length;
}
if (!partial) {
  assert.equal(outcomes.actual.verified, manifest.activities);
  assert.equal(outcomes.frozen.verified, manifest.activities);
  assert.equal(outcomes.frozen.groups, baseline.groups);
  assert.deepEqual(outcomes.actual.counts, baseline.statuses);
  assert.deepEqual(outcomes.frozen.counts, baseline.statuses);
  assert.equal(erasure?.persistedResponsesVerified, manifest.activities);
  assert.equal(erasure?.filesVerified, manifest.activities);
  assert.equal(erasure.remaining, 0);
}

const logs = (
  await readFile(new URL('hosted-matching-cloud-logs.jsonl', dir), 'utf8')
)
  .trimEnd()
  .split('\n')
  .filter(Boolean)
  .map(JSON.parse);
const functionNames = new Set([
  'matchingCatalogue:verificationPage',
  'matchingCatalogue:publish',
  'matchingCatalogueVerify:verify',
  'matchingReplay:reserve',
  'matchingReplay:publish',
  'matchingReplay:eraseBatch',
  'matchingGroups:load',
  'matchingGroups:inputs',
  'matchingGroups:commit',
  'matchingWorker:run',
  'lab:tilePage',
]);
const keys = [
  'databaseReadBytes',
  'databaseWriteBytes',
  'databaseIoReadBytes',
  'databaseIoWriteBytes',
  'databaseReadDocuments',
  'databaseWriteDocuments',
  'storageReadBytes',
  'storageWriteBytes',
  'networkEgressBytes',
];
const cloudLogs = {};
for (const log of logs) {
  if (log.kind !== 'Completion' || !functionNames.has(log.identifier)) continue;
  const tally = (cloudLogs[log.identifier] ??= {
    executions: 0,
    cached: 0,
    errors: 0,
    retries: 0,
    executionMs: 0,
    usage: Object.fromEntries(keys.map((key) => [key, 0])),
  });
  tally.executions++;
  if (log.cachedResult) tally.cached++;
  if (log.error) tally.errors++;
  if (log.willRetry) tally.retries++;
  tally.executionMs += 1000 * (log.executionTime ?? 0);
  for (const key of keys) tally.usage[key] += log.usageStats?.[key] ?? 0;
}
const report = {
  deployment: manifest.deployment,
  trialDate: '2026-11-07',
  library: {
    eligibleActivities: manifest.activities,
    ownerScopes: Object.keys(manifest.owners).length,
    sourceUncompressedBytes: manifest.uncompressedBytes,
    fileCompressedBytes: manifest.bytes,
    catalogueRows: (await read('export-summary.json')).count,
    catalogueSnapshotId: manifest.catalogue.snapshotId,
    catalogueRevision: manifest.catalogue.revision,
  },
  baseline: {
    groups: baseline.groups,
    statuses: baseline.statuses,
    wallMs: baseline.wallMs,
  },
  outcomes,
  synthetic,
  fixtureIngestion,
  erasure,
  cloudLogs: {
    scope:
      'Captured lab log window began partway through import and includes preliminary, corrected, synthetic, and cleanup runs. Function counters are telemetry separate from billing.',
    functions: cloudLogs,
  },
};
const target = new URL('../hosted-matching-results.json', import.meta.url);
await writeFile(target, JSON.stringify(report, null, 2) + '\n');
