import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const read = async (url) => JSON.parse(await readFile(url, 'utf8'));
const reports = await Promise.all(
  [0, 1].map((n) =>
    read(
      new URL(`../full-library-validation-${n}-results.json`, import.meta.url),
    ),
  ),
);
const median = (values) => {
  const xs = values.toSorted((a, b) => a - b);
  return (
    (xs[Math.floor((xs.length - 1) / 2)] + xs[Math.floor(xs.length / 2)]) / 2
  );
};
for (const report of reports) {
  assert.equal(report.records, 4602);
  assert.equal(report.expectedGroups, 1117);
  assert.equal(report.verifiedGroups, report.expectedGroups);
  assert.equal(report.groupsWithExecutionLogs, report.expectedGroups);
  assert(report.samples.every((s) => s.firstAttemptSucceeded));
  assert.equal(report.audit.persistedChecksVerified, 4602);
  assert.equal(report.audit.retainedFiles, 4602);
  assert.equal(report.profilePasses.length, 3);
}
const passes = reports.flatMap((r) => r.profilePasses);
const samples = reports.flatMap((r) => r.samples);
const profiles = ['original', '75k', '50k'].map((profile) => {
  const ps = passes.filter((p) => p.profile === profile);
  assert.equal(ps.length, 2);
  assert.deepEqual(ps.map((p) => p.repetition).sort(), [0, 1]);
  for (const pass of ps) {
    assert.equal(pass.totals.activities, 4602);
    assert.equal(pass.totals.compressedBytes, 238729963);
  }
  const ss = samples.filter((s) => s.profile === profile);
  const ratio = (p) =>
    p.totals.executionSeconds /
    passes.find(
      (b) => b.profile === 'original' && b.repetition === p.repetition,
    ).totals.executionSeconds;
  const seconds = ss.map((s) => s.executionSeconds).sort((a, b) => a - b);
  return {
    profile,
    groupsPerPass: ps[0].groups,
    passes: ps,
    median: Object.fromEntries(
      Object.keys(ps[0].totals).map((key) => [
        key,
        median(ps.map((p) => p.totals[key])),
      ]),
    ),
    executionSecondsRange: [
      Math.min(...ps.map((p) => p.totals.executionSeconds)),
      Math.max(...ps.map((p) => p.totals.executionSeconds)),
    ],
    relativeComputeWithinRepetition: ps.map(ratio),
    medianRelativeComputeWithinRepetition: median(ps.map(ratio)),
    medianComputeUsdUSStarter: median(ps.map((p) => p.computeUsdUSStarter)),
    maxProcessHighWaterMiB: Math.max(...ss.map((s) => s.rssMiB)),
    maxHighWaterAtStartMiB: Math.max(
      ...ss.map((s) => s.rssHighWaterAtStartMiB),
    ),
    maxSampledRSSMiB: Math.max(...ss.map((s) => s.rssObservedMiB)),
    maxSampledHeapMiB: Math.max(...ss.map((s) => s.heapPeakMiB)),
    maxHeapIncreaseMiB: Math.max(...ss.map((s) => s.phaseHeapIncreaseMiB)),
    groupsSampledRSSAbove512MiB: ss.filter((s) => s.rssObservedMiB > 512)
      .length,
    groupExecutionP95Seconds: seconds[Math.ceil(seconds.length * 0.95) - 1],
    maxGroupExecutionSeconds: seconds.at(-1),
  };
});
const result = {
  date: new Date().toISOString(),
  scope:
    'All 4602 frozen recordings, two sequential repetitions of original / 75k / 50k profiles; reverse order in repetition 1. Same uploaded files reused; derived results audited and reset between every profile.',
  statusesPerPass: { complete: 3719, uncovered: 824, partial: 59 },
  records: 4602,
  responsesVerified: 4602 * 6,
  groupsVerified: samples.length,
  firstAttemptSuccesses: samples.filter((s) => s.firstAttemptSucceeded).length,
  allocationMiB: [...new Set(reports.flatMap((r) => r.billedMemoryMiB))],
  retainedFiles: reports[1].audit.retainedFiles,
  retainedUntil: reports[1].audit.retainedUntil,
  caveats:
    reports[0].method +
    ' Two repetitions are descriptive, not a robust tail-latency study. Every profile publishes fresh results; benchmark reset/audit traffic is excluded. File billing counters are not complete. No deployment-matched PostGIS cost comparison was run.',
  profiles,
};
await writeFile(
  new URL('../full-library-validation-results.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result, null, 2));
