import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ConvexHttpClient } from 'convex/browser';
import { parse } from 'dotenv';

const directory = new URL('results/real-library-preview/', import.meta.url);
const { userId, athleteId, epoch } = JSON.parse(
  await readFile(new URL('session.json', directory)),
);
const { records } = JSON.parse(
  await readFile(new URL('metadata.json', directory)),
);
const { CONVEX_DEPLOY_KEY: key } = parse(
  await readFile(new URL('.env.sync-projection-proof', import.meta.url)),
);
assert(key?.startsWith('dev:spotted-fennec-603|'));
const client = new ConvexHttpClient('https://spotted-fennec-603.convex.cloud', {
  logger: false,
});
client.setAdminAuth(key);
const scope = { userId, athleteId, epoch };
const expected = records.map(({ activity }) => activity.id).sort();
async function snapshot() {
  let after = null;
  const ids = [];
  const hash = createHash('sha256');
  let requests = 0;
  const start = performance.now();
  while (true) {
    const page = await client.query('preview:read', {
      ...scope,
      operation: {
        kind: 'bootstrap',
        resource: 'activities',
        after,
        limit: 500,
      },
    });
    requests++;
    for (const item of page.items) {
      assert.equal(item.streams?.state, 'current');
      assert.equal(item.placeMatches?.userId, userId);
      assert.equal(
        item.placeMatches?.streamGeneration,
        item.streams.generation,
      );
      assert.equal(item.placeMatches?.streamRevision, item.streams.revision);
      ids.push(item.id);
      hash.update(JSON.stringify(item));
    }
    if (!page.more) break;
    after = page.items.at(-1).id;
  }
  assert.deepEqual(ids.sort(), expected);
  return {
    digest: hash.digest('hex'),
    requests,
    ms: Math.round(performance.now() - start),
  };
}

await assert.rejects(
  client.query('preview:read', {
    ...scope,
    epoch: 'wrong',
    operation: { kind: 'head' },
  }),
);
const before = await snapshot();
let backfill;
let batches = 0;
const began = performance.now();
do {
  backfill = await client.mutation('previewBackfill:next', scope);
  batches++;
} while (!backfill.done);
const backfillMs = Math.round(performance.now() - began);
const after = await snapshot();
assert.equal(after.digest, before.digest);
console.log(
  JSON.stringify({ before, after, backfill, batches, backfillMs }, null, 2),
);
