import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { ConvexHttpClient } from 'convex/browser';
import { parse } from 'dotenv';

const lab = new URL('./', import.meta.url);
const directory = new URL('results/real-library-preview/', lab);
const metadata = JSON.parse(
  await readFile(new URL('metadata.json', directory)),
);
const { CONVEX_DEPLOY_KEY: key } = parse(
  await readFile(new URL('.env.real-library-preview', lab)),
);
assert(key?.startsWith('dev:spotted-fennec-603|'));
const client = new ConvexHttpClient('https://spotted-fennec-603.convex.cloud', {
  logger: false,
});
client.setAdminAuth(key);
const run = await client.query('matchingReplay:state', { run: metadata.run });
assert.equal(run?.state, 'ready');
assert.equal(run.imported, metadata.records.length);
assert.equal(run.manifestHash, metadata.manifestHash);
assert(run.expiresAt > Date.now());
const configURL = new URL('session.json', directory);
const existing = await readFile(configURL, 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
const config = existing ?? {
  userId: metadata.sourceUserId,
  athleteId: metadata.athleteId,
  epoch: randomUUID(),
  key: randomBytes(32).toString('hex'),
  run: metadata.run,
};
assert.equal(config.run, metadata.run);
assert.equal(config.userId, metadata.sourceUserId);
assert.equal(config.athleteId, metadata.athleteId);
const scope = {
  userId: config.userId,
  athleteId: config.athleteId,
  epoch: config.epoch,
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
await client.mutation('previewLibrary:register', {
  ...scope,
  run: metadata.run,
  sourceUserId: metadata.sourceUserId,
  manifestHash: metadata.manifestHash,
  matchingVersion: hash(`${run.catalogue}:${run.generation}`),
});
await client.mutation('previewLibrary:armExpiry', scope);
await writeFile(
  configURL,
  JSON.stringify({ ...config, expiresAt: run.expiresAt }),
  { mode: 0o600 },
);
// Negative ownership tests must fail before a single row is published.
await assert.rejects(
  client.mutation('previewLibrary:publish', {
    ...scope,
    records: [
      {
        ...metadata.records[0],
        activity: {
          ...metadata.records[0].activity,
          athlete: String(metadata.athleteId + 1),
        },
      },
    ],
  }),
);
await assert.rejects(
  client.mutation('preview:read', {
    ...scope,
    epoch: randomUUID(),
    operation: { kind: 'head' },
  }),
);
for (let start = 0; start < metadata.records.length; start += 32) {
  await client.mutation('previewLibrary:publish', {
    ...scope,
    records: metadata.records.slice(start, start + 32),
  });
  if (start % 320 === 0)
    console.log(
      `Attached metadata ${Math.min(start + 32, metadata.records.length)}/${metadata.records.length}`,
    );
}
const ids = new Set();
let after = null;
let streams = 0,
  matches = 0,
  withPlaces = 0;
let sample;
while (true) {
  const page = await client.query('preview:read', {
    ...scope,
    operation: { kind: 'activities', after, limit: 32 },
  });
  for (const row of page) {
    assert(!ids.has(row.id));
    ids.add(row.id);
    if (row.streams?.state === 'current') streams++;
    if (row.placeMatches?.userId === scope.userId) matches++;
    if (row.placeMatches?.places.length) {
      withPlaces++;
      sample ??= row.id;
    }
  }
  if (page.length < 32) break;
  after = Number(page.at(-1).id);
}
assert.deepEqual(
  [...ids].sort(),
  metadata.records.map((row) => row.activity.id).sort(),
);
assert.equal(streams, metadata.records.length);
assert.equal(matches, metadata.records.length);
assert(sample, 'No matched-place sample found');
const cli = (...args) =>
  execFileSync(
    'pnpm',
    ['exec', 'convex', 'env', ...args, '--deployment', 'spotted-fennec-603'],
    { cwd: lab, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
const envKey = 'ACTIVITYMAP_PREVIEW_BRIDGE_DIGESTS';
const previous = cli('get', envKey);
cli(
  'set',
  envKey,
  JSON.stringify({
    ...(previous ? JSON.parse(previous) : {}),
    [config.userId]: hash(config.key),
  }),
);
const final = {
  ...config,
  expiresAt: run.expiresAt,
  sampleActivityId: sample,
  count: ids.size,
};
await writeFile(configURL, JSON.stringify(final), { mode: 0o600 });
await writeFile(
  new URL('attachment-report.json', directory),
  JSON.stringify(
    { count: ids.size, streams, matches, withPlaces, expiresAt: run.expiresAt },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    attached: ids.size,
    streams,
    matches,
    withPlaces,
    recordingsReuploaded: 0,
  }),
);
