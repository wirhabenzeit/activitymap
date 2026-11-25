import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { ConvexHttpClient } from 'convex/browser';
import { parse } from 'dotenv';

import { createBatchActivityPlaceMatcher } from '../../../../src/server/application/batch-activity-places.ts';
import {
  createBatchCoverage,
  routeSections,
} from '../../../../src/server/places/batch-coverage.ts';
import {
  canonicalJson,
  sha256,
} from '../../../../src/server/places/catalogue-artifact.ts';
import { SERVER_MATCHER_POLICY as policy } from '../../../../src/server/places/matching-version.ts';
import { placeQueryWindows } from '../../../../src/server/places/query-windows.ts';
import { prepareTrack } from '../../../../src/server/places/track-sections.ts';
import {
  encodeWhole,
  sha256 as fileHash,
  validateRecording,
} from './recording/codec.ts';
import { generateFixture } from './recording/fixtures.ts';
import { recordingSummary } from './recording/processing.ts';

const base = new URL('./results/', import.meta.url);
const prior = new URL('hosted-matching-private/', base);
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
const save = async (url, value) => {
  const tmp = new URL(`${url.href}.tmp`);
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, url);
};
const digest = (value) => sha256(canonicalJson(value));
const catalogue = await read(new URL('catalogue.json', base));
const exported = await readFile(new URL('places.jsonl', base), 'utf8');
const exportInfo = await read(new URL('export-summary.json', base));
assert.equal(fileHash(Buffer.from(exported)), exportInfo.sha256);
const places = exported
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line).metadata);
const scoped = (windows) =>
  places.filter((p) =>
    windows.some(
      (w) =>
        p.location.longitude >= w.west &&
        p.location.longitude <= w.east &&
        p.location.latitude >= w.south &&
        p.location.latitude <= w.north,
    ),
  );
const candidateDigest = (windows) =>
  digest(scoped(windows).sort((a, b) => a.id.localeCompare(b.id)));
await mkdir(dir, { recursive: true, mode: 0o700 });
const mode = process.argv[2];

function split(indices, records, cap) {
  const groups = [];
  let group = [],
    samples = 0,
    bytes = 0;
  for (const index of indices) {
    const m = records[index].manifest;
    if (
      group.length &&
      (samples + (m.counts.latlng ?? 0) > cap.samples ||
        bytes + m.uncompressedBytes > cap.bytes ||
        group.length >= cap.activities)
    ) {
      groups.push(group);
      group = [];
      samples = 0;
      bytes = 0;
    }
    group.push(index);
    samples += m.counts.latlng ?? 0;
    bytes += m.uncompressedBytes;
  }
  if (group.length) groups.push(group);
  return groups;
}

if (mode === 'prepare') {
  assert(
    !(await read(new URL('session.json', dir)).catch(() => null)),
    'Refusing to replace a prepared upload session',
  );
  // Pin the existing lossless, read-only source snapshot. No production reads.
  const original = await read(new URL('manifest.json', prior));
  const baseline = await read(new URL('full-library/plan-private.json', base));
  const frozen = await read(new URL('replay-frozen.json', prior));
  const expected = new Map(
    baseline.groups.flatMap((g) => g.activities.map((a) => [a.id, a])),
  );
  const heavy = frozen.groups
    .map((g, i) => ({ g, i }))
    .sort(
      (a, b) =>
        (b.g.metrics.rssObservedMiB ?? 0) - (a.g.metrics.rssObservedMiB ?? 0),
    )
    .slice(0, 4)
    .map((x) => x.i);
  const maxIndex = (fn) =>
    frozen.groups.reduce(
      (best, g, i) => (fn(g) > fn(frozen.groups[best]) ? i : best),
      0,
    );
  const selected = fullLibrary
    ? frozen.groups.map((_, i) => i)
    : syntheticOnly
      ? []
      : [
          ...new Set([
            ...heavy,
            maxIndex((g) => g.indices.length),
            maxIndex((g) => g.metrics.tiles),
          ]),
        ];
  const sourceIndices = [
    ...new Set(selected.flatMap((i) => frozen.groups[i].indices)),
  ];
  const reindex = new Map(sourceIndices.map((id, i) => [id, i]));
  const records = sourceIndices.map((id, index) => ({
    ...original.records[id],
    index,
    sourceIndex: id,
    file: `../hosted-matching-private/${id}.gz`,
    summaryFile: `../hosted-matching-private/${id}.summary.json`,
    expected: expected.get(original.records[id].key),
  }));
  for (const r of records) assert(r.expected?.hash);
  const scenarios = selected.map((id, i) => ({
    label: `real-${i + 1}`,
    kind: 'real',
    sourceGroup: id,
    indices: frozen.groups[id].indices.map((id) => reindex.get(id)),
  }));
  if (fullLibrary) {
    assert.equal(records.length, 4602);
    assert.equal(new Set(sourceIndices).size, original.records.length);
    const caps = [
      {
        label: 'original',
        samples: Infinity,
        bytes: Infinity,
        activities: 500,
      },
      { label: '75k', samples: 75000, bytes: 12 * 1024 ** 2, activities: 36 },
      { label: '50k', samples: 50000, bytes: 8 * 1024 ** 2, activities: 24 },
    ];
    if (repetition === 1) caps.reverse();
    const trials = caps.map((cap) => ({
      label: 'full-library',
      kind: 'real',
      profile: cap.label,
      repetition,
      groups: scenarios.flatMap((scenario) =>
        split(scenario.indices, records, cap),
      ),
    }));
    for (const trial of trials) {
      assert.equal(trial.groups.flat().length, records.length);
      assert.equal(new Set(trial.groups.flat()).size, records.length);
    }
    for (const record of records) {
      const file = await readFile(new URL(`${record.sourceIndex}.gz`, prior));
      assert.equal(fileHash(file, 'base64'), record.compressedHash);
    }
    const oldSession = await read(new URL('session.json', prior));
    const study = {
      generation: randomUUID(),
      catalogue: oldSession.catalogue,
      catalogueIdentity: original.catalogue,
      source: 'All 4602 records from the existing frozen local fixture export',
      records,
      scenarios: [
        {
          label: 'full-library',
          kind: 'real',
          indices: records.map((r) => r.index),
        },
      ],
      trials,
      manifestHash: digest(records),
    };
    await save(new URL('plan.json', dir), study);
    console.log(
      JSON.stringify({
        records: records.length,
        repetition,
        profiles: trials.map((t) => ({
          profile: t.profile,
          groups: t.groups.length,
        })),
        compressedBytes: records.reduce(
          (s, r) => s + r.manifest.compressedBytes,
          0,
        ),
      }),
    );
    process.exit(0);
  }
  const coverage = createBatchCoverage(catalogue.coverage);
  function synthetic(n, center, offset = 0) {
    const streams = generateFixture(n);
    // Same closed path and sample shape for every geographic variant.
    streams.latlng.data = Array.from({ length: n }, (_, i) => [
      center.lat + 0.012 * Math.sin((i / (n - 1)) * 2 * Math.PI) + offset,
      center.lon + 0.018 * Math.cos((i / (n - 1)) * 2 * Math.PI) + offset,
    ]);
    streams.distance.data = Array.from(
      { length: n },
      (_, i) => (i / (n - 1)) * 9000,
    );
    streams.time.data = Array.from({ length: n }, (_, i) => i * 2);
    return streams;
  }
  const centers = [];
  // Interior quarter-degree cell centers; a full covered loop is required.
  for (let lat = 45.125; lat < 48.5; lat += 0.25)
    for (let lon = 6.125; lon < 16.5; lon += 0.25) {
      const center = { lat, lon };
      const track = prepareTrack(synthetic(96, center), policy);
      if (
        !coverage.covers(routeSections(track.geometry), policy.discoveryRadiusM)
      )
        continue;
      const windows = placeQueryWindows(
        track.geometry,
        policy.discoveryRadiusM,
      );
      const candidates = scoped(windows).length;
      const tileRows = places.filter(
        (p) =>
          Math.floor((p.location.longitude + 180) * 4) ===
            Math.floor((lon + 180) * 4) &&
          Math.floor((p.location.latitude + 90) * 4) ===
            Math.floor((lat + 90) * 4),
      ).length;
      centers.push({ ...center, candidates, tileRows });
    }
  const dense = [...centers]
    .sort((a, b) => b.candidates - a.candidates || b.tileRows - a.tileRows)
    .slice(0, 12);
  const sparse = [...centers]
    .filter((c) => c.candidates === 0)
    .sort((a, b) => a.tileRows - b.tileRows)
    .slice(0, 12);
  assert.equal(dense.length, 12);
  assert.equal(sparse.length, 12);
  const cases = [
    ['dense-overlap', 12, 2000, dense, false],
    ['dense-spread', 12, 2000, dense, true],
    ['sparse-overlap', 12, 2000, sparse, false],
    ['sparse-spread', 12, 2000, sparse, true],
    ['count-6', 6, 8000, dense, false],
    ['count-12', 12, 4000, dense, false],
    ['count-24', 24, 2000, dense, false],
    ['samples-12k', 12, 1000, dense, false],
    ['samples-96k', 12, 8000, dense, false],
  ];
  for (const [label, count, samples, anchors, spread] of cases) {
    const indices = [];
    for (let i = 0; i < count; i++) {
      const streams = validateRecording(
        synthetic(samples, anchors[spread ? i : 0], i * 0.00001),
      );
      const index = records.length,
        key = String(9000000000 + index),
        generation = randomUUID();
      const { file, manifest } = encodeWhole(streams);
      await writeFile(new URL(`${index}.gz`, dir), file, { mode: 0o600 });
      await save(
        new URL(`${index}.summary.json`, dir),
        recordingSummary(streams),
      );
      const track = prepareTrack(streams, policy);
      const windows = placeQueryWindows(
        track.geometry,
        policy.discoveryRadiusM,
      );
      const matcher = createBatchActivityPlaceMatcher({
        snapshot: {
          catalogue,
          places: scoped(windows),
          windows,
          revision: original.catalogue.revision,
        },
        policy,
      });
      const response = await matcher.match(
        {
          userId: 'synthetic',
          activityId: key,
          input: { payload: null, generation, revision: '1', too_large: false },
        },
        track,
      );
      assert.equal(
        response.status,
        'complete',
        `Synthetic ${label} must be fully covered`,
      );
      records.push({
        index,
        owner: 'synthetic',
        key,
        generation,
        revision: '1',
        sourceVersion: `synthetic-v1:${label}`,
        locationHint: {},
        manifest,
        compressedHash: fileHash(file, 'base64'),
        file: `batch-region-private/${index}.gz`,
        summaryFile: `batch-region-private/${index}.summary.json`,
        expected: { hash: digest(response), status: response.status },
      });
      indices.push(index);
    }
    scenarios.push({ label, kind: 'synthetic', indices });
  }
  const caps = [
    { label: '25k', samples: 25000, bytes: 4 * 1024 ** 2, activities: 12 },
    { label: '50k', samples: 50000, bytes: 8 * 1024 ** 2, activities: 24 },
    { label: '75k', samples: 75000, bytes: 12 * 1024 ** 2, activities: 36 },
    { label: '100k', samples: 100000, bytes: 16 * 1024 ** 2, activities: 48 },
    { label: 'original', samples: Infinity, bytes: Infinity, activities: 500 },
  ];
  const trials = [];
  for (let repetition = 0; repetition < 3; repetition++) {
    const block = [];
    for (const scenario of scenarios)
      for (const cap of scenario.kind === 'real' ||
      (syntheticOnly && scenario.label === 'samples-96k')
        ? caps
        : [caps.at(-1)])
        block.push({
          label: scenario.label,
          kind: scenario.kind,
          profile: cap.label,
          repetition,
          groups: split(scenario.indices, records, cap),
        });
    // Deterministic rotation/shuffle mixes large/small and real/geographic cases.
    let seed = 7129 + repetition;
    for (let i = block.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [block[i], block[j]] = [block[j], block[i]];
    }
    trials.push(...block);
  }
  const oldSession = await read(new URL('session.json', prior));
  const study = {
    generation: randomUUID(),
    catalogue: oldSession.catalogue,
    catalogueIdentity: original.catalogue,
    source: 'Existing frozen local fixture export; selected records only',
    records,
    scenarios,
    trials,
  };
  study.manifestHash = digest(records);
  await save(new URL('plan.json', dir), study);
  console.log(
    JSON.stringify({
      realRecordings: sourceIndices.length,
      syntheticRecordings: records.length - sourceIndices.length,
      realGroups: selected.length,
      scenarios: scenarios.length,
      trials: trials.length,
      actionGroups: trials.reduce((s, t) => s + t.groups.length, 0),
      compressedBytes: records.reduce(
        (s, r) => s + r.manifest.compressedBytes,
        0,
      ),
    }),
  );
  process.exit(0);
}

const plan = await read(new URL('plan.json', dir));
assert.equal(digest(plan.records), plan.manifestHash);
if (mode === 'extend') {
  assert(syntheticOnly, 'Extension is restricted to generated controls');
  if (!plan.extended) {
    const first = plan.trials.filter((t) => t.repetition === 0);
    const geography = first.filter((t) =>
      /^(dense|sparse)-(overlap|spread)$/.test(t.label),
    );
    for (let repetition = 3; repetition < 5; repetition++) {
      const block = first.map((t) => ({ ...t, repetition }));
      const cold = geography.map((t) => ({
        ...t,
        profile: 'original-cold',
        repetition: repetition - 3,
        cache: 'cold',
      }));
      block.splice(3, 0, ...cold);
      plan.trials.push(...block);
    }
    plan.trials.push(
      ...geography.map((t) => ({
        ...t,
        profile: 'original-cold',
        repetition: 2,
        cache: 'cold',
      })),
    );
    plan.extended = true;
    await save(new URL('plan.json', dir), plan);
  }
  console.log(
    JSON.stringify({
      trials: plan.trials.length,
      groups: plan.trials.reduce((s, t) => s + t.groups.length, 0),
    }),
  );
  process.exit(0);
}
if (syntheticOnly)
  assert(
    plan.records.every(
      (r) =>
        r.owner === 'synthetic' &&
        r.sourceIndex === undefined &&
        r.sourceVersion.startsWith('synthetic-v1:'),
    ),
    'Synthetic-only mode refuses private source recordings',
  );
const origin = 'https://spotted-fennec-603.convex.cloud';
const key = parse(
  await readFile(
    new URL(
      fullLibrary ? './.env.full-validation' : './.env.region-benchmark',
      import.meta.url,
    ),
  ),
).CONVEX_DEPLOY_KEY;
assert(key?.startsWith('dev:spotted-fennec-603|'));
const client = new ConvexHttpClient(origin, { logger: false });
client.setAdminAuth(key);
const sessionFile = new URL('session.json', dir);
let session = await read(sessionFile).catch((e) => {
  if (e.code !== 'ENOENT') throw e;
  return null;
});
if (mode === 'reuse') {
  assert(
    fullLibrary && repetition === 1,
    'Reuse is only for the second full-library repetition',
  );
  assert(
    !(await read(new URL('trials.json', dir)).catch(() => null)),
    'Refusing to reset a started repetition',
  );
  const first = new URL('full-library-validation-0/', base);
  const firstPlan = await read(new URL('plan.json', first));
  const firstTrials = await read(new URL('trials.json', first));
  const firstAudit = await read(new URL('audit.json', first));
  assert.equal(firstPlan.manifestHash, plan.manifestHash);
  assert.equal(
    firstTrials.groups.length,
    firstPlan.trials.reduce((n, t) => n + t.groups.length, 0),
  );
  assert.equal(firstAudit.persistedChecksVerified, plan.records.length);
  assert.equal(firstAudit.persistedChecksAuditPassed, true);
  session = await read(new URL('session.json', first));
  const state = await client.query('matchingReplay:state', {
    run: session.run,
  });
  assert(state && ['ready', 'resetting'].includes(state.state));
  if (state.state === 'ready')
    await client.mutation('matchingReplay:reset', { run: session.run });
  let ready = false;
  for (let i = 0; i < 600; i++) {
    const current = await client.query('matchingReplay:state', {
      run: session.run,
    });
    assert(current, 'Retained replay disappeared');
    if (current.state === 'ready') {
      ready = true;
      break;
    }
    assert.equal(current.state, 'resetting');
    await sleep(500);
  }
  assert(ready, 'Replay reset did not finish');
  await save(sessionFile, { ...session, reusedFromRepetition: 0 });
  console.log(
    'Retained recordings reused; derived results reset for repetition 1',
  );
  process.exit(0);
}
if (mode === 'upload') {
  if (!session) {
    const run = await client.mutation('matchingReplay:create', {
      label: `matching-region-${plan.generation}`,
      generation: plan.generation,
      expected: plan.records.length,
      manifestHash: plan.manifestHash,
      catalogue: plan.catalogue,
    });
    session = { run, manifestHash: plan.manifestHash };
    await save(sessionFile, session);
  }
  assert.equal(session.manifestHash, plan.manifestHash);
  if (fullLibrary && !session.retention) {
    session.retention = await client.mutation('matchingReplay:retain', {
      run: session.run,
      hours: 168,
    });
    await save(sessionFile, session);
    console.log(
      JSON.stringify({
        retainedUntil: new Date(session.retention.expiresAt).toISOString(),
      }),
    );
  }
  const state = await client.query('matchingReplay:state', {
    run: session.run,
  });
  if (state.state === 'ready') {
    console.log('Already uploaded');
    process.exit(0);
  }
  for (let offset = 0; offset < plan.records.length; offset += 12) {
    const subset = plan.records.slice(offset, offset + 12);
    const reservations = await client.mutation('matchingReplay:reserve', {
      run: session.run,
      records: subset.map((r) => ({
        index: r.index,
        userId: r.owner,
        key: r.key,
        sourceVersion: r.sourceVersion.startsWith('synthetic-')
          ? r.sourceVersion
          : `postgres-v1:${r.sourceVersion}`,
        generation: r.generation,
        originalRevision: r.revision,
        locationHint: r.locationHint ?? {},
        manifest: r.manifest,
        compressedHash: r.compressedHash,
      })),
    });
    const settled = await Promise.allSettled(
      reservations.map(async (r) => {
        const record = plan.records[r.index];
        const path =
          record.sourceIndex !== undefined
            ? new URL(`${record.sourceIndex}.gz`, prior)
            : new URL(`${record.index}.gz`, dir);
        const file = await readFile(path);
        assert.equal(fileHash(file, 'base64'), record.compressedHash);
        assert.equal(new URL(r.url).origin, origin);
        const response = await fetch(r.url, {
          method: 'POST',
          headers: { 'Content-Type': r.contentType },
          body: file,
          redirect: 'error',
          signal: AbortSignal.timeout(90000),
        });
        assert(response.ok);
        const summary = await read(
          record.sourceIndex !== undefined
            ? new URL(`${record.sourceIndex}.summary.json`, prior)
            : new URL(`${record.index}.summary.json`, dir),
        );
        return {
          item: r.item,
          attempt: r.attempt,
          file: (await response.json()).storageId,
          summary,
        };
      }),
    );
    const uploads = settled
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
    if (uploads.length)
      await client.mutation('matchingReplay:publish', {
        run: session.run,
        uploads,
      });
    assert(
      settled.every((r) => r.status === 'fulfilled'),
      'Upload failure; rerun to resume',
    );
    if (offset % 60 === 0)
      console.log(
        JSON.stringify({
          uploadedThrough: offset + subset.length,
          total: plan.records.length,
        }),
      );
  }
  await client.mutation('matchingReplay:ready', { run: session.run });
  console.log('Scoped upload ready');
  process.exit(0);
}
assert(session?.run && session.manifestHash === plan.manifestHash);
const run = session.run;
if (mode === 'erase' || mode === 'audit') {
  let cursor = null;
  const files = [];
  const checks = [];
  let auditFailure;
  try {
    do {
      const page = await client.query('matchingReplay:files', { run, cursor });
      files.push(...page.files);
      checks.push(...page.checks);
      cursor = page.done ? null : page.cursor;
    } while (cursor !== null);
    await save(new URL('files-private.json', dir), files);
    assert.equal(new Set(files).size, plan.records.length);
    const ownerSequences = new Map();
    for (const check of checks) {
      const record = plan.records[check.index];
      assert(record, 'Unexpected persisted recording');
      assert.equal(check.result.userId, record.owner);
      assert.equal(check.result.activityId, record.key);
      assert.equal(check.result.streamGeneration, record.generation);
      assert.equal(
        check.result.streamRevision,
        String(check.recordingRevision),
      );
      assert.equal(
        digest({ ...check.result, streamRevision: record.revision }),
        record.expected.hash,
      );
      if (!ownerSequences.has(record.owner))
        ownerSequences.set(record.owner, new Set());
      const seen = ownerSequences.get(record.owner);
      assert(!seen.has(check.sequence), 'Duplicate owner sequence');
      seen.add(check.sequence);
    }
    assert.equal(checks.length, plan.records.length);
    for (const seen of ownerSequences.values()) {
      assert(
        Array.from({ length: seen.size }, (_, i) => i + 1).every((n) =>
          seen.has(n),
        ),
        'Owner change sequence has a gap',
      );
    }
  } catch (error) {
    auditFailure = error;
  } finally {
    if (mode === 'erase')
      await client.mutation('matchingReplay:erase', { run });
  }
  if (mode === 'audit') {
    if (auditFailure) throw auditFailure;
    let present = 0;
    for (let i = 0; i < files.length; i += 100)
      present += await client.query('matchingReplay:filesRemaining', {
        files: files.slice(i, i + 100),
      });
    assert.equal(present, plan.records.length);
    const state = await client.query('matchingReplay:state', { run });
    assert.equal(state.state, 'ready');
    assert(state.expiresAt > Date.now());
    const audit = {
      files: files.length,
      retainedFiles: present,
      retainedUntil: new Date(state.expiresAt).toISOString(),
      persistedChecksVerified: checks.length,
      persistedChecksAuditPassed: true,
    };
    await save(new URL('audit.json', dir), audit);
    console.log(JSON.stringify(audit));
    process.exit(0);
  }
  for (let i = 0; i < 360; i++) {
    if (!(await client.query('matchingReplay:state', { run }))) break;
    await sleep(500);
  }
  assert.equal(await client.query('matchingReplay:state', { run }), null);
  let remaining = 0;
  for (let i = 0; i < files.length; i += 100)
    remaining += await client.query('matchingReplay:filesRemaining', {
      files: files.slice(i, i + 100),
    });
  assert.equal(remaining, 0);
  await save(new URL('erasure.json', dir), {
    files: files.length,
    remaining,
    runErased: true,
    persistedChecksVerified: auditFailure ? null : checks.length,
    persistedChecksAuditPassed: !auditFailure,
  });
  if (auditFailure) throw auditFailure;
  console.log(JSON.stringify({ files: files.length, remaining }));
  process.exit(0);
}
assert.equal(mode, 'run');
const checkpoint = new URL('trials.json', dir);
const output = await read(checkpoint).catch((e) => {
  if (e.code !== 'ENOENT') throw e;
  return { run, groups: [] };
});
assert.equal(output.run, run);
const scheduled = plan.trials.flatMap((t, trial) =>
  t.groups.map((indices, part) => ({
    trial,
    part,
    indices,
    label: t.label,
    profile: t.profile,
    repetition: t.repetition,
    kind: t.kind,
    cache: t.cache ?? 'shared',
  })),
);
for (
  let ordinal = output.groups.length;
  ordinal < scheduled.length;
  ordinal++
) {
  const spec = scheduled[ordinal];
  // Each full-library profile publishes fresh results. Reset only benchmark
  // outputs between complete passes, leaving the retained recordings intact.
  if (
    fullLibrary &&
    ordinal > 0 &&
    scheduled[ordinal - 1].profile !== spec.profile &&
    output.resetBeforeOrdinal !== ordinal
  ) {
    if (output.resetAuditedOrdinal !== ordinal) {
      await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--import',
            'tsx',
            import.meta.filename,
            'audit',
            '--full-library',
            `--repetition=${repetition}`,
          ],
          { stdio: 'inherit' },
        );
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`Profile audit exited ${code}`)),
        );
      });
      await save(
        new URL(`audit-${scheduled[ordinal - 1].profile}.json`, dir),
        await read(new URL('audit.json', dir)),
      );
      output.resetAuditedOrdinal = ordinal;
      await save(checkpoint, output);
    }
    let state = await client.query('matchingReplay:state', { run });
    assert(state && ['ready', 'resetting'].includes(state.state));
    if (state.state === 'ready')
      await client.mutation('matchingReplay:reset', { run });
    let ready = false;
    for (let i = 0; i < 600; i++) {
      state = await client.query('matchingReplay:state', { run });
      assert(state, 'Retained replay disappeared');
      if (state.state === 'ready') {
        ready = true;
        break;
      }
      assert.equal(state.state, 'resetting');
      await sleep(500);
    }
    assert(ready, 'Profile reset did not finish');
    output.resetBeforeOrdinal = ordinal;
    await save(checkpoint, output);
    console.log(
      JSON.stringify({ profile: spec.profile, freshPublication: true }),
    );
  }
  const start = Date.now();
  const group = await client.mutation('matchingGroups:start', {
    run,
    mode: spec.cache === 'cold' ? 'profile-cold' : 'frozen',
    ordinal: output.groups.filter(
      (g) =>
        (g.cache ?? 'shared') === spec.cache &&
        (!fullLibrary || g.profile === spec.profile),
    ).length,
    items: spec.indices,
    parallelism: 1,
  });
  let result;
  for (let i = 0; i < 1200; i++) {
    result = await client.query('matchingGroups:status', { group });
    if (result.state !== 'pending') break;
    await sleep(150);
  }
  assert.equal(result.state, 'complete', result.failure);
  assert.deepEqual(
    result.matches.map((m) => m.index),
    spec.indices,
  );
  assert.equal(result.candidateHash, candidateDigest(result.windows));
  for (const match of result.matches) {
    assert.equal(
      match.hash,
      plan.records[match.index].expected.hash,
      `Response mismatch ${ordinal}/${match.index}`,
    );
    assert.equal(match.status, plan.records[match.index].expected.status);
  }
  const ws = result.windows;
  const area = (w) =>
    Math.max(0, w.east - w.west) *
    Math.max(0, w.north - w.south) *
    111.195 ** 2 *
    Math.cos((((w.north + w.south) / 2) * Math.PI) / 180);
  const envelope = ws.length
    ? {
        west: Math.min(...ws.map((w) => w.west)),
        east: Math.max(...ws.map((w) => w.east)),
        south: Math.min(...ws.map((w) => w.south)),
        north: Math.max(...ws.map((w) => w.north)),
      }
    : null;
  output.groups.push({
    ...spec,
    ordinal,
    group,
    metrics: result.metrics,
    observedMs: Date.now() - start,
    finishedAt: Date.now(),
    windowAreaSumKm2: ws.reduce((s, w) => s + area(w), 0),
    envelopeKm2: envelope ? area(envelope) : 0,
  });
  await save(checkpoint, output);
  if (ordinal % 10 === 0 || ordinal === scheduled.length - 1)
    console.log(
      JSON.stringify({
        completed: ordinal + 1,
        total: scheduled.length,
        case: spec.label,
        profile: spec.profile,
        repeat: spec.repetition,
        rssMiB: Math.round(result.metrics.rssObservedMiB),
        workerMs: Math.round(result.metrics.workerMs),
      }),
    );
}
console.log('All trials verified');
