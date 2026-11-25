import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const base = new URL('./results/', import.meta.url);
const syntheticOnly = process.argv.includes('--synthetic-only');
const fullLibrary = process.argv.includes('--full-library');
const repetition = Number(
  process.argv.find((a) => a.startsWith('--repetition='))?.split('=')[1] ?? 0,
);
assert(!fullLibrary || (!syntheticOnly && [0, 1].includes(repetition)));

const dir = new URL(
  fullLibrary
    ? `full-library-validation-${repetition}/`
    : syntheticOnly
      ? 'batch-region-synthetic/'
      : 'batch-region-private/',
  base,
);
const read = async (url) => JSON.parse(await readFile(url, 'utf8'));
const plan = await read(new URL('plan.json', dir));
const trials = await read(new URL('trials.json', dir));
const erasure = await read(new URL('erasure.json', dir)).catch(() => null);
const audit = await read(new URL('audit.json', dir)).catch(() => null);
const profileAudits = fullLibrary
  ? await Promise.all(
      plan.trials.map(async (trial, index) => ({
        profile: trial.profile,
        audit:
          index === plan.trials.length - 1
            ? audit
            : await read(new URL(`audit-${trial.profile}.json`, dir)).catch(
                () => null,
              ),
      })),
    )
  : [];

const logs = (
  await readFile(
    new URL(
      fullLibrary
        ? 'full-library-validation-cloud-logs.jsonl'
        : 'batch-region-cloud-logs.jsonl',
      base,
    ),
    'utf8',
  )
)
  .split('\n')
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
const groupExecution = new Map();
const groupAttempts = new Map();
for (const log of logs)
  if (log.identifier === 'matchingWorker:run')
    for (const line of log.logLines ?? []) {
      if (!line.messages?.some((m) => m.includes('batch-profile'))) continue;
      const value = line.messages.find((m) => m.includes('"group"'));
      const match = value?.match(/\{.*\}/s);
      if (match) {
        const { group, attempt } = JSON.parse(match[0]);
        groupExecution.set(group, log.executionId);
        if (!groupAttempts.has(group)) groupAttempts.set(group, new Map());
        groupAttempts.get(group).set(log.executionId, attempt);
      }
    }
const completions = new Map(
  logs.filter((l) => l.kind === 'Completion').map((l) => [l.executionId, l]),
);
const children = new Map();
for (const log of completions.values())
  if (log.parentExecutionId) {
    if (!children.has(log.parentExecutionId))
      children.set(log.parentExecutionId, []);
    children.get(log.parentExecutionId).push(log.executionId);
  }
const median = (values) => {
  const s = values.toSorted((a, b) => a - b);
  if (!s.length) return null;
  const middle = Math.floor(s.length / 2);
  return s.length % 2 ? s[middle] : (s[middle - 1] + s[middle]) / 2;
};
const sum = (xs) => xs.reduce((s, n) => s + n, 0);
const samples = [];
for (const g of trials.groups) {
  const root = groupExecution.get(g.group),
    worker = completions.get(root);
  const executions = [];
  const visit = (id) => {
    const l = completions.get(id);
    if (l) executions.push(l);
    for (const child of children.get(id) ?? []) visit(child);
  };
  if (root) visit(root);
  samples.push({
    scenario: g.label,
    kind: g.kind,
    profile: g.profile,
    repetition: g.repetition,
    part: g.part,
    observedMs: g.observedMs,
    ...g.metrics,
    envelopeKm2: g.envelopeKm2,
    windowAreaSumKm2: g.windowAreaSumKm2,
    executionSeconds: worker?.executionTime ?? null,
    executionAttempts: groupAttempts.get(g.group)?.size ?? 0,
    firstAttemptSucceeded: worker
      ? !worker.error &&
        groupAttempts.get(g.group)?.size === 1 &&
        [...groupAttempts.get(g.group).values()][0] === 1
      : false,
    actionGiBSeconds: worker
      ? (worker.usageStats.memoryUsedMb / 1024) * worker.executionTime
      : null,
    memoryBilledMiB: worker?.usageStats.memoryUsedMb ?? null,
    functions: executions.length,
    cachedFunctions: executions.filter((l) => l.cachedResult).length,
    databaseReadBytes: sum(
      executions.map((l) => l.usageStats?.databaseIoReadBytes ?? 0),
    ),
    databaseWriteBytes: sum(
      executions.map((l) => l.usageStats?.databaseIoWriteBytes ?? 0),
    ),
    fileReadCounterBytes: sum(
      executions.map((l) => l.usageStats?.storageReadBytes ?? 0),
    ),
    phaseHeapIncreaseMiB: g.metrics.heapPeakMiB - g.metrics.heapAtStartMiB,
  });
}
const rows = [];
for (const spec of plan.trials) {
  const matching = samples.filter(
    (s) =>
      s.scenario === spec.label &&
      s.profile === spec.profile &&
      s.repetition === spec.repetition,
  );
  if (matching.length !== spec.groups.length) continue;
  const totalNames = [
    'activities',
    'samples',
    'rawBytes',
    'compressedBytes',
    'fileMs',
    'decodeMs',
    'prepareMs',
    'tileMs',
    'scoreMs',
    'workerMs',
    'observedMs',
    'pages',
    'tiles',
    'scanned',
    'candidates',
    'windows',
    'executionSeconds',
    'actionGiBSeconds',
    'functions',
    'cachedFunctions',
    'databaseReadBytes',
    'databaseWriteBytes',
    'fileReadCounterBytes',
  ];
  const totals = Object.fromEntries(
    totalNames.map((k) => [
      k,
      matching.every((x) => x[k] !== null && x[k] !== undefined)
        ? sum(matching.map((x) => x[k]))
        : null,
    ]),
  );
  rows.push({
    scenario: spec.label,
    kind: spec.kind,
    profile: spec.profile,
    repetition: spec.repetition,
    groups: matching.length,
    totals,
    maxRSS: Math.max(...matching.map((x) => x.rssObservedMiB)),
    maxHeap: Math.max(...matching.map((x) => x.heapPeakMiB)),
    maxHeapIncrease: Math.max(...matching.map((x) => x.phaseHeapIncreaseMiB)),
    maxEnvelopeKm2: Math.max(...matching.map((x) => x.envelopeKm2)),
    windowAreaSumKm2: sum(matching.map((x) => x.windowAreaSumKm2)),
    computeUsdUSStarter:
      totals.actionGiBSeconds === null
        ? null
        : (totals.actionGiBSeconds / 3600) * 0.33,
  });
}
const comparisons = [];
for (const key of [...new Set(rows.map((r) => `${r.scenario}|${r.profile}`))]) {
  const [scenario, profile] = key.split('|');
  const rs = rows.filter(
    (r) => r.scenario === scenario && r.profile === profile,
  );
  const fields = Object.keys(rs[0].totals);
  comparisons.push({
    scenario,
    profile,
    repetitions: rs.length,
    groups: rs[0].groups,
    median: Object.fromEntries(
      fields.map((k) => [
        k,
        median(rs.map((r) => r.totals[k]).filter((v) => v !== null)),
      ]),
    ),
    minExecutionSeconds: Math.min(
      ...rs.map((r) => r.totals.executionSeconds ?? Infinity),
    ),
    maxExecutionSeconds: Math.max(
      ...rs.map((r) => r.totals.executionSeconds ?? 0),
    ),
    maxRSS: Math.max(...rs.map((r) => r.maxRSS)),
    medianPeakRSS: median(rs.map((r) => r.maxRSS)),
    medianPeakHeap: median(rs.map((r) => r.maxHeap)),
    medianHeapIncrease: median(rs.map((r) => r.maxHeapIncrease)),
    maxEnvelopeKm2: Math.max(...rs.map((r) => r.maxEnvelopeKm2)),
    windowAreaSumKm2: median(rs.map((r) => r.windowAreaSumKm2)),
    medianComputeUsdUSStarter: median(
      rs.map((r) => r.computeUsdUSStarter).filter((v) => v !== null),
    ),
  });
}
// Compare each profile over the same complete real-recording cohort. Summing
// per-scenario medians would not be the median of a complete pass.
const realScenarios = plan.scenarios.filter((s) => s.kind === 'real').length;
const profilePasses = [];
for (const profile of [
  ...new Set(rows.filter((r) => r.kind === 'real').map((r) => r.profile)),
]) {
  for (const repetition of [...new Set(rows.map((r) => r.repetition))]) {
    const selected = rows.filter(
      (r) =>
        r.kind === 'real' &&
        r.profile === profile &&
        r.repetition === repetition,
    );
    if (!realScenarios || selected.length !== realScenarios) continue;
    profilePasses.push({
      profile,
      repetition,
      groups: sum(selected.map((r) => r.groups)),
      totals: Object.fromEntries(
        Object.keys(selected[0].totals).map((k) => [
          k,
          selected.every((r) => r.totals[k] !== null)
            ? sum(selected.map((r) => r.totals[k]))
            : null,
        ]),
      ),
      maxRSS: Math.max(...selected.map((r) => r.maxRSS)),
      maxHeap: Math.max(...selected.map((r) => r.maxHeap)),
      maxHeapIncrease: Math.max(...selected.map((r) => r.maxHeapIncrease)),
      computeUsdUSStarter: selected.every((r) => r.computeUsdUSStarter !== null)
        ? sum(selected.map((r) => r.computeUsdUSStarter))
        : null,
    });
  }
}
const profileComparisons = [];
for (const profile of [...new Set(profilePasses.map((r) => r.profile))]) {
  const ps = profilePasses.filter((r) => r.profile === profile);
  const ratios = ps.flatMap((r) => {
    const base = profilePasses.find(
      (b) => b.profile === 'original' && b.repetition === r.repetition,
    );
    return base?.totals.executionSeconds && r.totals.executionSeconds
      ? [r.totals.executionSeconds / base.totals.executionSeconds]
      : [];
  });
  profileComparisons.push({
    profile,
    repetitions: ps.length,
    groups: ps[0].groups,
    median: Object.fromEntries(
      Object.keys(ps[0].totals).map((k) => [
        k,
        median(ps.map((r) => r.totals[k]).filter((v) => v !== null)),
      ]),
    ),
    minExecutionSeconds: Math.min(
      ...ps.map((r) => r.totals.executionSeconds ?? Infinity),
    ),
    maxExecutionSeconds: Math.max(
      ...ps.map((r) => r.totals.executionSeconds ?? 0),
    ),
    medianRelativeComputeWithinRepetition: median(ratios),
    maxRSS: Math.max(...ps.map((r) => r.maxRSS)),
    medianPeakRSS: median(ps.map((r) => r.maxRSS)),
    maxHeap: Math.max(...ps.map((r) => r.maxHeap)),
    medianComputeUsdUSStarter: median(
      ps.map((r) => r.computeUsdUSStarter).filter((v) => v !== null),
    ),
  });
}
const report = {
  date: new Date().toISOString(),
  scope: fullLibrary
    ? 'All 4602 frozen local recordings'
    : syntheticOnly
      ? 'Generated fixtures only'
      : 'Selected frozen local recordings and generated fixtures',
  method:
    (fullLibrary
      ? 'Each full-library profile publishes fresh checks; benchmark outputs audited and reset between profiles. Reset/audit control traffic excluded. '
      : 'Repeated checks reuse published results. ') +
    'Sequential actions; deterministic mixed-order repetitions, counts recorded per comparison; identical per-recording canonical results and independent full-catalogue rectangle oracle. Compute from execution logs, not observer wall time or peak RSS. Descendant function counters exclude driver polling/start mutation and future lease-check calls. All dollar figures model US Starter marginal usage before allowances, exclude file I/O, storage and other system costs.',
  expectedGroups: plan.trials.reduce((s, t) => s + t.groups.length, 0),
  verifiedGroups: trials.groups.length,
  groupsWithExecutionLogs: samples.filter((s) => s.executionSeconds !== null)
    .length,
  billedMemoryMiB: [...new Set(samples.map((s) => s.memoryBilledMiB))],
  records: plan.records.length,
  privateRecords: plan.records.filter((r) => r.sourceIndex !== undefined)
    .length,
  erasure,
  audit,
  profileAudits,
  comparisons,
  profileComparisons,
  profilePasses,
  rows,
  samples,
};
if (process.argv.includes('--complete')) {
  assert.equal(report.verifiedGroups, report.expectedGroups);
  if (fullLibrary)
    for (const { audit: profileAudit } of profileAudits) {
      assert.equal(profileAudit?.persistedChecksVerified, report.records);
      assert.equal(profileAudit?.persistedChecksAuditPassed, true);
      assert.equal(profileAudit?.retainedFiles, report.records);
    }
  assert.equal(report.groupsWithExecutionLogs, report.expectedGroups);
  assert(
    report.samples.every((s) => s.firstAttemptSucceeded),
    'Retry/failure cost requires separate accounting',
  );
  const retained = process.argv.includes('--retained');
  const verification = retained ? report.audit : report.erasure;
  assert.equal(verification?.files, report.records);
  if (retained) assert.equal(verification.retainedFiles, report.records);
  else {
    assert.equal(verification.remaining, 0);
    assert.equal(verification.runErased, true);
  }
  if (!syntheticOnly) {
    assert.equal(verification.persistedChecksVerified, report.records);
    assert.equal(verification.persistedChecksAuditPassed, true);
    for (const pass of profilePasses) {
      assert.equal(pass.totals.activities, report.privateRecords);
      assert(pass.totals.executionSeconds > 0);
    }
  }
}
const target = new URL(
  fullLibrary
    ? `../full-library-validation-${repetition}-results.json`
    : syntheticOnly
      ? '../batch-region-synthetic-results.json'
      : '../batch-region-results.json',
  import.meta.url,
);
await writeFile(target, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    verified: report.verifiedGroups,
    expected: report.expectedGroups,
    logged: report.groupsWithExecutionLogs,
    billedMemoryMiB: report.billedMemoryMiB,
    profileComparisons,
    comparisons: comparisons.map((c) => ({
      scenario: c.scenario,
      profile: c.profile,
      repetitions: c.repetitions,
      seconds: c.median.executionSeconds,
      peakRSS: c.medianPeakRSS,
      heap: c.medianPeakHeap,
      tiles: c.median.tiles,
      candidates: c.median.candidates,
    })),
  }),
);
