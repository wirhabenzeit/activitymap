import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { ConvexHttpClient } from 'convex/browser';
import { parse } from 'dotenv';

import { canonicalJson } from '../../../../src/server/places/catalogue-artifact.ts';
import { encodeWhole, sha256, validateRecording } from './recording/codec.ts';
import { FIXTURE_SAMPLES, generateFixture } from './recording/fixtures.ts';
import { recordingSummary } from './recording/processing.ts';

const results = new URL('./results/', import.meta.url);
const privateFiles = new URL('hosted-matching-private/', results);
const read = async (url) => JSON.parse(await readFile(url, 'utf8'));
const save = async (url, data) => {
  const temporary = new URL(`${url.href}.tmp`);
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', {
    mode: 0o600,
  });
  await rename(temporary, url);
};
const hash = (value) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
const origin = 'https://spotted-fennec-603.convex.cloud';
const key = parse(
  await readFile(new URL('./.env.matching-benchmark', import.meta.url)),
).CONVEX_DEPLOY_KEY;
assert(key?.startsWith('dev:spotted-fennec-603|'));
const client = new ConvexHttpClient(origin, { logger: false });
client.setAdminAuth(key);
const session = await read(new URL('session.json', privateFiles));
const run = session.run;
const plan = await read(new URL('full-library/plan-private.json', results));
const manifest = await read(new URL('manifest.json', privateFiles));
assert.equal(manifest.indexHash, session.manifestHash);
assert.deepEqual(manifest.catalogue, plan.version);

const exportInfo = await read(new URL('export-summary.json', results));
const exported = await readFile(new URL('places.jsonl', results), 'utf8');
assert.equal(sha256(Buffer.from(exported)), exportInfo.sha256);
const oracle = exported
  .trimEnd()
  .split('\n')
  .map((line) => JSON.parse(line).metadata);
assert.equal(oracle.length, exportInfo.count);
const order = (items) => items.sort((a, b) => a.id.localeCompare(b.id));
function candidateDigest(windows) {
  return hash(
    order(
      oracle.filter((p) =>
        windows.some(
          (b) =>
            p.location.longitude >= b.west &&
            p.location.longitude <= b.east &&
            p.location.latitude >= b.south &&
            p.location.latitude <= b.north,
        ),
      ),
    ),
  );
}
const byId = new Map(
  plan.candidates.map((candidate, index) => [candidate.activityId, index]),
);
const expected = new Map(
  plan.groups.flatMap((group) =>
    group.activities.map((a) => [byId.get(a.id), a]),
  ),
);
assert.equal(expected.size, manifest.activities);

async function scheduled(run, options) {
  const started = performance.now();
  const group = await client.mutation('matchingGroups:start', {
    run,
    ...options,
  });
  for (
    let elapsed = 0;
    elapsed < 300_000;
    elapsed = performance.now() - started
  ) {
    const result = await client.query('matchingGroups:status', { group });
    assert(result);
    if (result.state !== 'pending')
      return { result, observedMs: performance.now() - started };
    await sleep(100);
  }
  throw new Error(
    'Scheduled matching did not finish before the probe deadline',
  );
}

function verifyGroup(group, { indexList, windows } = {}) {
  assert.equal(
    group.state,
    'complete',
    group.failure ?? 'Group did not complete',
  );
  assert.equal(
    group.candidateHash,
    candidateDigest(group.windows),
    'Independent exact-window candidate digest differs',
  );
  if (indexList)
    assert.deepEqual(
      group.matches.map((m) => m.index),
      indexList,
    );
  let windowDrift = 0;
  if (windows) {
    assert.equal(
      group.windows.length,
      windows.length,
      'Frozen window count differs',
    );
    for (const [i, bounds] of windows.entries())
      for (const field of ['west', 'south', 'east', 'north'])
        windowDrift = Math.max(
          windowDrift,
          Math.abs(bounds[field] - group.windows[i][field]),
        );
    // Architecture-specific last-bit trig differences are observable. Both
    // bounds sets must still select exactly the same catalogue rows.
    assert(
      windowDrift < 1e-10,
      'Frozen window coordinates differ beyond roundoff',
    );
    assert.equal(
      group.candidateHash,
      candidateDigest(windows),
      'Frozen window candidate digest differs',
    );
  }
  for (const item of group.matches) {
    assert(expected.has(item.index), 'Unexpected response identity');
    assert(
      item.hash === expected.get(item.index).hash &&
        item.status === expected.get(item.index).status,
      `Canonical PostGIS response differs at manifest position ${item.index}`,
    );
  }
  return windowDrift;
}

async function erase(run) {
  await client.mutation('matchingReplay:erase', { run });
  for (let attempt = 0; attempt < 360; attempt++) {
    if (!(await client.query('matchingReplay:state', { run }))) return;
    await sleep(500);
  }
  throw new Error('Replay erasure has not completed');
}

const mode = process.argv[2];
if (mode === 'arm-expiry') {
  const state = await client.query('matchingReplay:state', { run });
  assert(
    state?.manifestHash === manifest.indexHash,
    'Replay expiry scope differs',
  );
  await client.mutation('matchingReplay:arm', { run });
  console.log('Replay expiry armed');
  process.exit(0);
}

if (mode === 'reset') {
  await client.mutation('matchingReplay:reset', { run });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (
      (await client.query('matchingReplay:state', { run }))?.state === 'ready'
    ) {
      const stamp = Date.now();
      for (const name of [
        'single',
        'actual',
        'frozen',
        'parallel',
        'bounded',
      ]) {
        await rename(
          new URL(`replay-${name}.json`, privateFiles),
          new URL(`replay-${name}.reset-${stamp}.json`, privateFiles),
        ).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
      }
      console.log('Derived replay checkpoints cleared; recordings retained');
      process.exit(0);
    }
    await sleep(400);
  }
  throw new Error('Replay reset has not completed');
}

if (mode === 'erase') {
  const state = await client.query('matchingReplay:state', { run });
  if (state)
    assert(
      state.manifestHash === manifest.indexHash,
      'Replay erasure scope differs',
    );
  const auditFile = new URL('erasure-audit-private.json', privateFiles);
  let audit = await read(auditFile).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  let auditFailure;
  try {
    if (!audit && state?.state === 'ready') {
      const pages = [];
      const sequences = new Set();
      let verified = 0;
      let cursor = null;
      do {
        const page = await client.query('matchingReplay:files', {
          run,
          cursor,
        });
        pages.push(page.files);
        for (const item of page.checks) {
          const record = manifest.records[item.index];
          assert(
            item.result.streamRevision === String(item.recordingRevision),
            'Persisted recording revision differs',
          );
          assert.equal(
            hash({ ...item.result, streamRevision: record.revision }),
            expected.get(item.index).hash,
            'Persisted response differs from canonical baseline',
          );
          assert(
            !sequences.has(item.sequence),
            'Duplicate owner change sequence',
          );
          sequences.add(item.sequence);
          verified++;
        }
        cursor = page.done ? null : page.cursor;
      } while (cursor !== null);
      const files = pages.flat();
      assert.equal(new Set(files).size, manifest.activities);
      // The frozen manifest currently contains one owner; sequence uniqueness
      // is scoped to that owner by the underlying transaction.
      assert.equal(Object.keys(manifest.owners).length, 1);
      if (verified === manifest.activities)
        assert(
          Array.from({ length: verified }, (_, i) => i + 1).every((seq) =>
            sequences.has(seq),
          ),
          'Persisted owner sequence has a gap',
        );
      audit = { pages, persistedResponsesVerified: verified };
      await save(auditFile, audit);
    }
  } catch (error) {
    auditFailure = error;
  } finally {
    await erase(run);
  }
  let remaining = 0;
  for (const files of audit?.pages ?? []) {
    remaining += await client.query('matchingReplay:filesRemaining', { files });
  }
  assert.equal(remaining, 0);
  if (auditFailure) throw auditFailure;
  const erased = {
    filesVerified: audit?.pages.flat().length ?? 0,
    persistedResponsesVerified: audit?.persistedResponsesVerified ?? 0,
    remaining,
    runErased: true,
  };
  await save(new URL('hosted-matching-erasure.json', results), erased);
  console.log(JSON.stringify(erased));
  process.exit(0);
}

if (mode === 'ingestion') {
  const account = await client.mutation('ingestionJobs:createAccount', {
    app: `fixture-matching-${randomUUID()}`,
    matchingCatalogue: session.catalogue,
  });
  let scope;
  const send = async (value) => {
    await client.mutation('ingestionJobs:setFixture', { account, value });
    await client.mutation('ingestionJobs:receive', {
      account,
      generation: 1,
      receipt: String(value.version),
      value,
    });
  };
  async function waitFor(check) {
    for (let i = 0; i < 90; i++) {
      const result = await check();
      if (result) return result;
      await sleep(250);
    }
    throw new Error('Durable fixture did not reach its expected state');
  }
  try {
    const value = {
      key: '1001',
      version: 1,
      fixture: 'typical',
      deleted: false,
    };
    await send(value);
    scope = await waitFor(() =>
      client.query('matchingFixture:current', { account, key: value.key }),
    );
    const first = await waitFor(() =>
      client.query('matchingGroups:check', scope),
    );
    assert.equal(first.check.sourceVersion, 'fixture-v1:1');
    assert.equal(first.check.result.activityId, value.key);
    assert.equal(first.check.recordingRevision, 1);
    assert.equal(first.change.sequence, 1);
    await send({ ...value, version: 2, fixture: 'empty' });
    assert.equal(await client.query('matchingGroups:check', scope), null);
    const second = await waitFor(async () => {
      const next = await client.query('matchingFixture:current', {
        account,
        key: value.key,
      });
      if (!next || next.index === scope.index) return null;
      return client.query('matchingGroups:check', next);
    });
    assert.equal(second.check.sourceVersion, 'fixture-v1:2');
    assert.equal(second.check.recordingRevision, 2);
    assert.equal(second.check.result.status, 'missing_streams');
    assert.equal(second.change.sequence, 2);
    await send({ ...value, version: 3, deleted: true });
    assert.equal(
      await client.query('matchingFixture:current', {
        account,
        key: value.key,
      }),
      null,
    );
    const summary = {
      initial: first.check.result.status,
      emptyUpdate: second.check.result.status,
      changeSequences: [first.change.sequence, second.change.sequence],
      sourceUpdateAndDeletionFenced: true,
    };
    await save(new URL('hosted-matching-ingestion.json', results), summary);
    console.log(JSON.stringify(summary));
  } finally {
    await client.mutation('ingestionJobs:revoke', { account });
    if (scope)
      await waitFor(
        async () =>
          !(await client.query('matchingReplay:state', { run: scope.run })),
      );
  }
  process.exit(0);
}

if (mode === 'synthetic') {
  const data = [];
  const wide = generateFixture(300);
  wide.latlng.data = wide.latlng.data.map((_, i) => [
    23.1 + Math.floor(i / 100),
    -90.1 + (i % 100) * 0.5,
  ]);
  for (const [label, streams] of [
    ['largest', generateFixture(FIXTURE_SAMPLES.largest)],
    ['score-limit', generateFixture(100_000)],
    ['postgres-missing-gps', {}],
    ['wide', wide],
    ['typical', generateFixture(FIXTURE_SAMPLES.typical)],
  ]) {
    const { file, manifest } = encodeWhole(validateRecording(streams));
    const generation = randomUUID();
    const run = await client.mutation('matchingReplay:create', {
      label: `matching-${label}-${generation}`,
      generation,
      expected: 1,
      manifestHash: manifest.contentHash,
      catalogue: session.catalogue,
    });
    try {
      const [reservation] = await client.mutation('matchingReplay:reserve', {
        run,
        records: [
          {
            index: 0,
            userId: 'synthetic',
            key: '1',
            sourceVersion:
              label === 'postgres-missing-gps'
                ? 'postgres-v1:00000000000000000000000000000000'
                : `synthetic-v1:${label}`,
            generation,
            originalRevision: '1',
            locationHint: {},
            manifest,
            compressedHash: sha256(file, 'base64'),
          },
        ],
      });
      assert.equal(new URL(reservation.url).origin, origin);
      const upload = await fetch(reservation.url, {
        method: 'POST',
        headers: { 'Content-Type': reservation.contentType },
        body: file,
        redirect: 'error',
      });
      assert(upload.ok);
      const { storageId } = await upload.json();
      await client.mutation('matchingReplay:publish', {
        run,
        uploads: [
          {
            item: reservation.item,
            attempt: reservation.attempt,
            file: storageId,
            summary: recordingSummary(streams),
          },
        ],
      });
      await client.mutation('matchingReplay:ready', { run });
      const { result, observedMs } = await scheduled(run, {
        mode: 'single',
        ordinal: 0,
        items: [0],
        interruptFirstAttempt: label === 'typical',
      });
      const resultRow = await client.query('matchingGroups:check', {
        run,
        index: 0,
      });
      if (label === 'wide') {
        assert.equal(result.failure, 'catalogue_incomplete');
        assert.equal(result.state, 'failed');
        assert.equal(resultRow, null);
      } else {
        assert.equal(result.state, 'complete', result.failure);
        assert.equal(result.candidateHash, candidateDigest(result.windows));
        assert.equal(result.metrics.samples, manifest.counts.latlng ?? 0);
        assert.equal(result.metrics.compressedBytes, manifest.compressedBytes);
        assert.equal(resultRow.check.result.streamRevision, '1');
        assert.equal(resultRow.change.sequence, 1);
        assert.equal(resultRow.change.key, '1');
        if (label === 'largest') {
          assert.equal(result.matches[0].status, 'partial');
          assert(result.metrics.rssMiB < 512);
        } else if (label === 'postgres-missing-gps') {
          assert.equal(result.matches[0].status, 'partial');
        } else if (label === 'score-limit') {
          assert(result.metrics.sections > 0 && result.metrics.pages > 0);
        } else {
          assert.equal(result.attempt, 2);
          const resumed = await scheduled(run, {
            mode: 'single',
            ordinal: 0,
            items: [0],
          });
          assert.equal(resumed.result._id, result._id);
          assert.equal(
            (await client.query('matchingGroups:check', { run, index: 0 }))
              .change.sequence,
            1,
          );
        }
      }
      data.push({
        fixture: label,
        samples: manifest.counts.latlng,
        observedMs,
        attempt: result.attempt,
        phase: result.state,
        failure: result.failure,
        status: result.matches?.[0]?.status,
        metrics: result.metrics,
      });
    } finally {
      await erase(run);
    }
  }
  await save(new URL('hosted-matching-synthetic.json', results), data);
  console.log(JSON.stringify({ verifiedFixtures: data.length }));
  process.exit(0);
}

assert(
  ['single', 'actual', 'frozen', 'parallel', 'bounded', 'isolated'].includes(
    mode,
  ),
);
assert.equal(
  (await client.query('matchingReplay:state', { run }))?.state,
  'ready',
);
const checkpoint = new URL(`replay-${mode}.json`, privateFiles);
const data = await read(checkpoint).catch((e) => {
  if (e.code !== 'ENOENT') throw e;
  return { run, mode, groups: [], wallMs: 0 };
});
assert.equal(data.run, run);
const seen = new Set(data.groups.flatMap((g) => g.indices));
const starting = performance.now();
const previousWall = data.wallMs;
const single = mode === 'single';
const parallel = mode === 'parallel';
const bounded = mode === 'bounded';
const isolated = mode === 'isolated';
let explicitGroups;
let pairedSequentialTileMs;
let boundedSourceGroups;
if (single) explicitGroups = [{ indices: [0] }];
if (mode === 'frozen' || parallel || bounded || isolated) {
  const frozenGroups = plan.groups.map((group) => ({
    indices: group.activities.map((a) => byId.get(a.id)),
    windows: group.windows,
  }));
  if (mode === 'frozen') explicitGroups = frozenGroups;
  else {
    const actual = await read(new URL('replay-actual.json', privateFiles));
    const sequential = await read(new URL('replay-frozen.json', privateFiles));
    assert(
      actual.run === run && sequential.run === run,
      'Probe must use the verified sequential run',
    );
    assert.equal(
      actual.groups.flatMap((g) => g.indices).length,
      manifest.activities,
    );
    assert.equal(sequential.groups.length, plan.groups.length);
    if (parallel) {
      const dense = sequential.groups
        .map((g, index) => ({ index, metrics: g.metrics }))
        .sort((a, b) => b.metrics.tiles - a.metrics.tiles || a.index - b.index)
        .slice(0, 12);
      assert(
        dense.every((g) => g.metrics.tiles >= 4),
        'Parallel trial needs multi-tile groups',
      );
      explicitGroups = dense.map(({ index }) => frozenGroups[index]);
      pairedSequentialTileMs = dense.reduce(
        (sum, group) => sum + group.metrics.tileMs,
        0,
      );
    } else {
      const heavy = sequential.groups
        .map((group, index) => ({ group, index }))
        .filter(({ group }) => (group.metrics.rssObservedMiB ?? 0) > 512)
        .sort(
          (a, b) =>
            b.group.metrics.rssObservedMiB - a.group.metrics.rssObservedMiB,
        )
        .slice(0, 4);
      assert(
        heavy.length > 0,
        'Memory trials need a measured heavy sequential group',
      );
      boundedSourceGroups = {
        groups: heavy.length,
        maxObservedRssMiB: heavy[0].group.metrics.rssObservedMiB,
        samplesPerSubgroup: 25_000,
        rawBytesPerSubgroup: 4 * 1024 * 1024,
        activitiesPerSubgroup: 12,
      };
      explicitGroups = isolated
        ? heavy.map(({ index }) => frozenGroups[index])
        : heavy.flatMap(({ group }) => {
            const splits = [];
            let indices = [];
            let samples = 0;
            let bytes = 0;
            for (const index of group.indices) {
              const { manifest: m } = manifest.records[index];
              const nextSamples = m.counts.latlng ?? 0;
              if (
                indices.length &&
                (indices.length >= boundedSourceGroups.activitiesPerSubgroup ||
                  samples + nextSamples >
                    boundedSourceGroups.samplesPerSubgroup ||
                  bytes + m.uncompressedBytes >
                    boundedSourceGroups.rawBytesPerSubgroup)
              ) {
                splits.push({ indices });
                indices = [];
                samples = 0;
                bytes = 0;
              }
              indices.push(index);
              samples += nextSamples;
              bytes += m.uncompressedBytes;
            }
            if (indices.length) splits.push({ indices });
            return splits;
          });
    }
  }
}
const completedActual =
  mode === 'actual' && data.groups.at(-1)?.indices.length === 0;
const expectedGroups =
  explicitGroups?.length ?? (completedActual ? data.groups.length : Infinity);
for (let ordinal = data.groups.length; ordinal < expectedGroups; ordinal++) {
  const indexList = explicitGroups?.[ordinal].indices;
  const { result, observedMs } = await scheduled(run, {
    mode,
    ordinal,
    items: indexList,
    parallelism: parallel ? 4 : 1,
  });
  const windowDrift = verifyGroup(result, {
    indexList,
    windows: explicitGroups?.[ordinal].windows,
  });
  for (const { index } of result.matches) {
    assert(!seen.has(index), 'Duplicate verified response');
    seen.add(index);
  }
  if (single) {
    const committed = await client.query('matchingGroups:check', {
      run,
      index: indexList[0],
    });
    const record = manifest.records[indexList[0]];
    assert(
      committed.check.result.userId === record.owner,
      'Committed owner differs',
    );
    assert(
      committed.check.result.activityId === record.key,
      'Committed activity differs',
    );
    assert(
      committed.check.result.streamGeneration === record.generation,
      'Committed generation differs',
    );
    assert.equal(
      committed.check.result.streamRevision,
      String(committed.check.recordingRevision),
    );
    assert(committed.change.key === record.key, 'Change activity differs');
    assert.equal(committed.change.sequence, committed.check.sequence);
  }
  data.groups.push({
    indices: result.matches.map((m) => m.index),
    observedMs,
    windowDrift,
    metrics: result.metrics,
    statuses: result.matches.map((m) => m.status),
  });
  data.wallMs = previousWall + performance.now() - starting;
  await save(checkpoint, data);
  if (ordinal % 20 === 0)
    console.log(
      JSON.stringify({ mode, groups: ordinal + 1, verified: seen.size }),
    );
  if (mode === 'actual' && result.matches.length === 0) break;
  if (
    mode === 'actual' &&
    process.env.MATCHING_STOP_AFTER === String(ordinal + 1)
  ) {
    console.log(
      JSON.stringify({
        stoppedAfterCheckpoint: ordinal + 1,
        verified: seen.size,
      }),
    );
    process.exit(0);
  }
}
assert.equal(
  seen.size,
  explicitGroups
    ? explicitGroups.reduce((sum, group) => sum + group.indices.length, 0)
    : manifest.activities,
);
const counts = {};
const max = {};
const totals = {};
for (const group of data.groups) {
  for (const status of group.statuses)
    counts[status] = (counts[status] ?? 0) + 1;
  for (const [k, value] of Object.entries(group.metrics)) {
    if (!k.startsWith('rss')) totals[k] = (totals[k] ?? 0) + value;
    max[k] = Math.max(max[k] ?? 0, value);
  }
}
const sequences =
  mode === 'actual' || mode === 'frozen'
    ? await client.query('matchingReplay:ownerSequences', { run })
    : undefined;
if (sequences) {
  assert.equal(sequences.length, Object.keys(manifest.owners).length);
  assert.equal(
    sequences.reduce((sum, owner) => sum + owner.head, 0),
    manifest.activities,
  );
  for (const owner of sequences) {
    assert.equal(owner.first, 1);
    assert.equal(owner.last, owner.head);
  }
}
const summary = {
  mode,
  changeRecords: sequences?.reduce((sum, owner) => sum + owner.head, 0),
  groups: data.groups.filter((g) => g.indices.length).length,
  verified: data.groups.reduce((sum, g) => sum + g.indices.length, 0),
  exactWindowOracle: data.groups.length,
  pairedSequentialTileMs,
  boundedSourceGroups,
  maxFrozenWindowDriftDegrees: Math.max(
    0,
    ...data.groups.map((g) => g.windowDrift ?? 0),
  ),
  counts,
  wallMs: data.wallMs,
  totals,
  max,
};
await save(new URL(`hosted-matching-${mode}.json`, results), summary);
console.log(JSON.stringify(summary));
