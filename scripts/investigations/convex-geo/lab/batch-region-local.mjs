import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

import { activityPlacesResponseSchema } from '../../../../src/contracts/activity-places.ts';
import { createBatchActivityPlaceMatcher } from '../../../../src/server/application/batch-activity-places.ts';
import {
  canonicalJson,
  sha256,
} from '../../../../src/server/places/catalogue-artifact.ts';
import { SERVER_MATCHER_POLICY as policy } from '../../../../src/server/places/matching-version.ts';
import {
  placeQueryWindows,
  uniqueQueryWindows,
} from '../../../../src/server/places/query-windows.ts';
import { prepareTrack } from '../../../../src/server/places/track-sections.ts';
import { decodeWhole } from './recording/codec.ts';

const base = new URL('./results/', import.meta.url),
  dir = new URL('batch-region-private/', base),
  prior = new URL('hosted-matching-private/', base);
const read = async (url) => JSON.parse(await readFile(url, 'utf8'));
const plan = await read(new URL('plan.json', dir));
const catalogue = await read(new URL('catalogue.json', base));
const hash = (value) => sha256(canonicalJson(value));
const input = async (record) =>
  decodeWhole(
    await readFile(new URL(`${record.sourceIndex}.gz`, prior)),
    record.manifest,
  );
const payload = (streams) =>
  streams.latlng ? streams : { ...streams, latlng: null };
const taskFile = new URL('local-cases.json', dir);
if (process.argv[2] === '--worker') {
  const task = (await read(taskFile))[Number(process.argv[3])];
  const memory = () => ({
    rss: process.memoryUsage.rss() / 1024 ** 2,
    heap: process.memoryUsage().heapUsed / 1024 ** 2,
  });
  const startMemory = memory();
  let maxRSS = startMemory.rss,
    maxHeap = startMemory.heap;
  const sample = () => {
    const m = memory();
    maxRSS = Math.max(maxRSS, m.rss);
    maxHeap = Math.max(maxHeap, m.heap);
  };
  const start = performance.now();
  let decodeMs = 0,
    prepareMs = 0,
    readMs = 0;
  const tracks = [];
  for (const index of task.indices) {
    const r = plan.records[index];
    let t = performance.now();
    const file = await readFile(new URL(`${r.sourceIndex}.gz`, prior));
    readMs += performance.now() - t;
    t = performance.now();
    const streams = decodeWhole(file, r.manifest);
    decodeMs += performance.now() - t;
    sample();
    t = performance.now();
    const track = prepareTrack(payload(streams), policy);
    tracks.push({ r, track });
    prepareMs += performance.now() - t;
    sample();
  }
  const afterPrepare = memory();
  const t = performance.now();
  const matcher = createBatchActivityPlaceMatcher({
    snapshot: {
      catalogue,
      places: task.places,
      windows: task.windows,
      revision: plan.catalogueIdentity.revision,
    },
    policy,
  });
  for (const { r, track } of tracks) {
    const result = activityPlacesResponseSchema.parse(
      await matcher.match(
        {
          userId: r.owner,
          activityId: r.key,
          input: {
            payload: null,
            generation: r.generation,
            revision: r.revision,
            too_large: false,
          },
        },
        track,
      ),
    );
    assert.equal(hash(result), r.expected.hash);
    sample();
  }
  console.log(
    JSON.stringify({
      readMs,
      decodeMs,
      prepareMs,
      scoreMs: performance.now() - t,
      totalMs: performance.now() - start,
      startMemory,
      afterPrepare,
      maxRSS,
      maxHeap,
      processHighWaterMiB: process.resourceUsage().maxRSS / 1024,
    }),
  );
  process.exit(0);
}
const places = (await readFile(new URL('places.jsonl', base), 'utf8'))
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l).metadata);
const windowsByIndex = new Map();
for (const r of plan.records.filter((r) => r.sourceIndex !== undefined))
  windowsByIndex.set(
    r.index,
    placeQueryWindows(
      prepareTrack(payload(await input(r)), policy).geometry,
      policy.discoveryRadiusM,
    ),
  );
const specs = plan.trials.filter(
  (t) => t.kind === 'real' && t.repetition === 0,
);
const tasks = specs.flatMap((t) =>
  t.groups.map((indices, part) => {
    const windows = uniqueQueryWindows(
      indices.flatMap((i) => windowsByIndex.get(i)),
    );
    const selected = places.filter((p) =>
      windows.some(
        (w) =>
          p.location.longitude >= w.west &&
          p.location.longitude <= w.east &&
          p.location.latitude >= w.south &&
          p.location.latitude <= w.north,
      ),
    );
    return {
      scenario: t.label,
      profile: t.profile,
      part,
      indices,
      windows,
      places: selected,
      samples: indices.reduce(
        (s, i) => s + (plan.records[i].manifest.counts.latlng ?? 0),
        0,
      ),
      rawBytes: indices.reduce(
        (s, i) => s + plan.records[i].manifest.uncompressedBytes,
        0,
      ),
    };
  }),
);
await writeFile(taskFile, JSON.stringify(tasks), { mode: 0o600 });
const resultsFile = new URL('local-trials.json', dir);
const results = await read(resultsFile).catch((e) => {
  if (e.code !== 'ENOENT') throw e;
  return [];
});
for (let repetition = 0; repetition < 3; repetition++)
  for (let offset = 0; offset < tasks.length; offset++) {
    const index = (offset * 37 + repetition * 13) % tasks.length;
    // Use a simple rotation if the multiplier is not coprime.
    const i =
      tasks.length % 37 === 0
        ? (offset + repetition * 13) % tasks.length
        : index;
    if (results.some((r) => r.repetition === repetition && r.task === i))
      continue;
    const value = await new Promise((resolve, reject) => {
      const p = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          new URL(import.meta.url).pathname,
          '--worker',
          String(i),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '',
        err = '';
      p.stdout.on('data', (b) => (out += b));
      p.stderr.on('data', (b) => (err += b));
      p.on('error', reject);
      p.on('close', (code) =>
        code ? reject(new Error(err)) : resolve(JSON.parse(out.trim())),
      );
    });
    const task = tasks[i];
    results.push({
      task: i,
      repetition,
      scenario: task.scenario,
      profile: task.profile,
      part: task.part,
      activities: task.indices.length,
      samples: task.samples,
      rawBytes: task.rawBytes,
      candidates: task.places.length,
      windows: task.windows.length,
      ...value,
    });
    await writeFile(resultsFile, JSON.stringify(results, null, 2) + '\n', {
      mode: 0o600,
    });
    if (results.length % 30 === 0)
      console.log(
        JSON.stringify({ completed: results.length, total: tasks.length * 3 }),
      );
  }
assert.equal(results.length, tasks.length * 3);
await writeFile(
  new URL('../batch-region-local-results.json', import.meta.url),
  JSON.stringify(
    {
      scope:
        'Local-only private recordings; new Node process per group; candidate subsets precomputed outside measured interval; no network, hosting or billing comparison',
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      verified: results.length,
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ verified: results.length, completed: true }));
