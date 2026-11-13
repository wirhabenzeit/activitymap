import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { ConvexHttpClient } from 'convex/browser';
import { parse } from 'dotenv';

import { canonicalJson } from '../../../../src/server/places/catalogue-artifact.ts';

const results = new URL('./results/', import.meta.url);
const directory = new URL('hosted-matching-private/', results);
const read = async (url) => JSON.parse(await readFile(url, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = await read(new URL('manifest.json', directory));
const benchmarkKey = parse(
  await readFile(new URL('./.env.matching-benchmark', import.meta.url)),
).CONVEX_DEPLOY_KEY;
const deployment = 'spotted-fennec-603';
const origin = `https://${deployment}.convex.cloud`;
assert(benchmarkKey?.startsWith(`dev:${deployment}|`));
assert.equal(manifest.deployment, deployment);
assert.equal(manifest.activities, 4602);
assert.equal(sha(JSON.stringify(manifest.records)), manifest.indexHash);
assert.deepEqual(
  Object.fromEntries(
    Object.keys(manifest.owners).map((owner) => [
      owner,
      manifest.records.filter((r) => r.owner === owner).length,
    ]),
  ),
  manifest.owners,
);
const client = new ConvexHttpClient(origin, { logger: false });
client.setAdminAuth(benchmarkKey);

const sessionPath = new URL('session.json', directory);
let session = await read(sessionPath).catch((e) => {
  if (e.code !== 'ENOENT') throw e;
  return null;
});
if (!session) {
  const exportInfo = await read(new URL('export-summary.json', results));
  const source = await readFile(new URL('places.jsonl', results), 'utf8');
  assert.equal(sha(source), exportInfo.sha256);
  assert.equal(exportInfo.dataset, manifest.catalogue.snapshotId);
  const rows = source
    .trimEnd()
    .split('\n')
    .map(JSON.parse)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const digest = createHash('sha256');
  for (const row of rows) digest.update(canonicalJson(row) + '\n');
  const catalogue = await client.action('matchingCatalogueVerify:verify', {
    artifact: await readFile(new URL('catalogue.json', results), 'utf8'),
    revision: manifest.catalogue.revision,
    rowsHash: digest.digest('hex'),
    count: exportInfo.count,
  });
  const generation = randomUUID();
  session = {
    catalogue,
    generation,
    label: `matching-${generation}`,
    manifestHash: manifest.indexHash,
  };
  await writeFile(sessionPath, JSON.stringify(session), { mode: 0o600 });
}
assert.equal(session.manifestHash, manifest.indexHash);
const run = await client.mutation('matchingReplay:create', {
  ...session,
  expected: manifest.activities,
  run: undefined,
});
await writeFile(sessionPath, JSON.stringify({ ...session, run }), {
  mode: 0o600,
});
const state = await client.query('matchingReplay:state', { run });
if (state.state === 'ready') {
  console.log('Replay import already complete');
  process.exit(0);
}

let published = state.imported;
for (let offset = 0; offset < manifest.records.length; offset += 24) {
  const records = manifest.records.slice(offset, offset + 24);
  const reservations = await client.mutation('matchingReplay:reserve', {
    run,
    records: records.map((r) => ({
      index: r.index,
      userId: r.owner,
      key: r.key,
      sourceVersion: `postgres-v1:${r.sourceVersion}`,
      generation: r.generation,
      originalRevision: r.revision,
      locationHint: r.locationHint ?? {},
      manifest: r.manifest,
      compressedHash: r.compressedHash,
    })),
  });
  const uploads = await Promise.allSettled(
    reservations.map(async ({ index, item, attempt, url, contentType }) => {
      assert.equal(new URL(url).origin, origin);
      const file = await readFile(new URL(`${index}.gz`, directory));
      assert.equal(
        createHash('sha256').update(file).digest('base64'),
        manifest.records[index].compressedHash,
      );
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: file,
        redirect: 'error',
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok)
        throw new Error(`Replay upload rejected: HTTP ${response.status}`);
      const { storageId } = await response.json();
      return {
        item,
        attempt,
        file: storageId,
        summary: await read(new URL(`${index}.summary.json`, directory)),
      };
    }),
  );
  const ready = uploads
    .filter((upload) => upload.status === 'fulfilled')
    .map((upload) => upload.value);
  if (ready.length)
    published += await client.mutation('matchingReplay:publish', {
      run,
      uploads: ready,
    });
  if (uploads.some((upload) => upload.status === 'rejected')) {
    throw new Error(
      `Replay upload interrupted at ${published} published recordings; rerun to resume`,
    );
  }
  if (offset % 240 === 0)
    console.log(JSON.stringify({ published, expected: manifest.activities }));
}
await client.mutation('matchingReplay:ready', { run });
console.log(
  JSON.stringify({ published, expected: manifest.activities, ready: true }),
);
